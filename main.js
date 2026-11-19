const { app, BrowserWindow, ipcMain, shell, safeStorage, screen, nativeTheme, dialog } = require('electron');
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');
// The app was called GlassDesk: keep its data folder (sign-ins, links, settings) under the new name.
// WORKMATE_DATA_DIR lets tests run beside a real copy without touching (or locking) its data.
app.setPath('userData', process.env.WORKMATE_DATA_DIR || path.join(app.getPath('appData'), 'glassdesk'));

// Only one Workmate Desk at a time. A second launch (e.g. the desktop shortcut while it's already open)
// must exit right here: it used to get far enough to start its own local server on the next port and
// overwrite the dock's connection file before quitting, leaving the dock pointing at nothing.
if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
const bridgeLib = require('./bridge');

const GOOGLE_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.modify', // read + change labels (mark as read); cannot send or delete
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');
const ASANA_API = 'https://app.asana.com/api/1.0';
// Smallest sizes that still show every title-bar button plus the Windows caption buttons (~140px)
const WIDGET_SIZE = { width: 440, height: 720 };
const MIN = { widget: [440, 520], full: [900, 560] };
const fit = (b, [w, h]) => ({ ...b, width: Math.max(b.width || w, w), height: Math.max(b.height || h, h) });

// ---------- config (secrets encrypted with Windows DPAPI via safeStorage) ----------
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
let cfg = { google: {}, asana: {}, ai: {}, ui: {}, links: {}, urgency: { threads: {}, senders: {} }, muted: ['asana.com', 'everhour.com'] };
const loadCfg = () => { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch {} };
const saveCfg = () => fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
const enc = (s) => safeStorage.encryptString(s).toString('base64');
const dec = (s) => (s ? safeStorage.decryptString(Buffer.from(s, 'base64')) : '');

const publicCfg = () => ({
  google: {
    clientId: cfg.google.clientId || '', hasSecret: !!cfg.google.secret, connected: !!cfg.google.refresh, email: cfg.google.email || '',
    canModify: (cfg.google.scope || '').includes('gmail.modify'),
  },
  asana: { connected: !!cfg.asana.pat, user: cfg.asana.user || null, workspaces: cfg.asana.workspaces || [], workspaceGid: cfg.asana.workspaceGid || '' },
  everhour: { connected: !!cfg.everhour?.key, user: cfg.everhour?.user || null },
  mcp: { enabled: !!cfg.mcp?.enabled, running: bridge.running(), port: cfg.mcp?.port || null },
  ai: { connected: !!cfg.ai.key || ['platform', 'claude-code'].includes(cfg.ai.mode), mode: cfg.ai.mode || (cfg.ai.key ? 'key' : ''), version: cfg.ai.version || '' },
  ui: { theme: theme(), closeAction: cfg.ui.closeAction || 'ask', pinned: !!cfg.ui.pinned, widget: !!cfg.ui.widget, openAtLogin: !!cfg.ui.openAtLogin },
});

// ---------- Google OAuth (installed-app loopback + PKCE) ----------
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function googleSignIn(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        `<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">${ok ? 'Signed in. You can close this tab and return to Workmate Desk.' : 'Sign-in failed. Return to Workmate Desk and try again.'}</body>`);
      server.close();
      clearTimeout(timer);
      if (!ok) return reject(new Error(url.searchParams.get('error') || 'Google sign-in was cancelled'));
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code'),
            code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
          }),
        });
        const tok = await r.json();
        if (!r.ok) throw new Error(tok.error_description || tok.error || 'Token exchange failed');
        resolve(tok);
      } catch (e) { reject(e); }
    });
    let redirectUri;
    const timer = setTimeout(() => { server.close(); reject(new Error('Google sign-in timed out')); }, 5 * 60 * 1000);
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
      }).forEach(([k, v]) => auth.searchParams.set(k, v));
      shell.openExternal(auth.toString());
    });
  });
}

let access = { token: '', exp: 0 };
async function googleToken(force) {
  if (!force && access.token && Date.now() < access.exp - 60_000) return access.token;
  if (!cfg.google.refresh) throw new Error('Google is not connected');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.google.clientId, client_secret: dec(cfg.google.secret),
      refresh_token: dec(cfg.google.refresh), grant_type: 'refresh_token',
    }),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error(`Google session expired, reconnect in Settings (${tok.error})`);
  access = { token: tok.access_token, exp: Date.now() + tok.expires_in * 1000 };
  return access.token;
}

async function googleFetch(url, init = {}, retried) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.googleapis.com')) throw new Error('Blocked non-Google URL');
  const r = await fetch(u, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await googleToken(retried)}` } });
  if (r.status === 401 && !retried) return googleFetch(url, init, true);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error?.message || `Google API ${r.status}`);
  return body;
}

async function asanaFetch(p, init = {}, pat = dec(cfg.asana.pat)) {
  if (!p.startsWith('/')) throw new Error('Bad Asana path');
  const r = await fetch(ASANA_API + p, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${pat}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.errors?.[0]?.message || `Asana API ${r.status}`);
  return body;
}

// Everhour (time tracking): personal API key from the Everhour profile page
// Today's date on this PC. Everhour files a timer under `userDate`; without it, it uses its own (UTC)
// date, which for UTC+ time zones is still yesterday in the morning.
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function everhourFetch(p, init = {}, key = dec(cfg.everhour?.key)) {
  if (!p.startsWith('/')) throw new Error('Bad Everhour path');
  // every timer start (app, dock, Claude Code) goes through here: always file it under today's local date
  if (p === '/timers' && init.method === 'POST') {
    const body = JSON.parse(init.body || '{}');
    init = { ...init, body: JSON.stringify({ ...body, userDate: body.userDate || localDate() }) };
  }
  const r = await fetch('https://api.everhour.com' + p, {
    ...init, headers: { ...init.headers, 'X-Api-Key': key, 'Content-Type': 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error('NOT_IN_EVERHOUR');
  if (!r.ok) throw new Error(body.message || `Everhour API ${r.status}`);
  return body;
}

// ---------- appearance ----------
// bg: aurora | morandi | mist | graphite | transparent (Windows acrylic) | picture; mode: system | light | dark
const BGS = ['aurora', 'morandi', 'mist', 'graphite', 'transparent', 'picture'];
const theme = () => ({ bg: 'aurora', mode: 'system', dim: 35, ...(cfg.ui.theme || {}) });
const picPath = () => cfg.ui.theme?.pic && path.join(app.getPath('userData'), cfg.ui.theme.pic);

function applyTheme() {
  const t = theme();
  nativeTheme.themeSource = t.mode;
  if (!win) return;
  const glass = t.bg === 'transparent';
  win.setBackgroundMaterial(glass ? 'acrylic' : 'none'); // the frosted Windows 11 material; ignored on Windows 10
  win.setBackgroundColor(glass ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#060a1a' : '#dde8ff');
}

// a picked picture is copied into Workmate Desk's own folder, so moving or deleting the original doesn't break it
function picDataUrl() {
  const f = picPath();
  if (!f || !fs.existsSync(f)) return '';
  const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(f).toString('base64')}`;
}

// ---------- Asana attachments ----------
// Images are cached per task in userData/attachments/<task>/ ; a task's folder is deleted
// when the task hasn't been opened for 14 days (".opened" is touched on every open).
const ATT_ROOT = () => path.join(app.getPath('userData'), 'attachments');
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const KEEP_DAYS = 14;

function cleanAttachmentCache() {
  const root = ATT_ROOT();
  if (!fs.existsSync(root)) return;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const d of fs.readdirSync(root)) {
    const marker = path.join(root, d, '.opened');
    const last = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
    if (last < cutoff) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
}

async function taskAttachments(taskGid) {
  if (!/^\d+$/.test(taskGid)) throw new Error('Bad task id');
  const dir = path.join(ATT_ROOT(), taskGid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.opened'), new Date().toISOString()); // keep this task's pictures another 14 days
  const r = await asanaFetch(`/attachments?parent=${taskGid}&opt_fields=name,size,host,download_url,view_url,permanent_url,created_at`);
  const out = [];
  for (const a of r.data) {
    const ext = (a.name.match(IMAGE)?.[1] || '').toLowerCase();
    const item = { gid: a.gid, name: a.name, size: a.size || 0, url: a.permanent_url || a.view_url, isImage: !!ext };
    // ponytail: images over 8 MB stay links instead of previews
    if (ext && a.download_url && (a.size || 0) <= 8 * 1024 * 1024) {
      const file = path.join(dir, `${a.gid}.${ext}`);
      try {
        if (!fs.existsSync(file)) {
          const res = await fetch(a.download_url); // short-lived signed link from Asana, no auth header needed
          if (!res.ok) throw new Error(String(res.status));
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        }
        item.dataUrl = `data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}`;
      } catch { /* preview unavailable; the chip still links to Asana */ }
    }
    out.push(item);
  }
  return out;
}

// upload a pasted/dropped file to the task (multipart, so not through asanaFetch's JSON headers)
async function uploadAttachment(taskGid, { name, type, base64 }) {
  if (!/^\d+$/.test(taskGid)) throw new Error('Bad task id');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 25 * 1024 * 1024) throw new Error(`${name} is over 25 MB`);
  const form = new FormData();
  form.append('parent', taskGid);
  form.append('file', new Blob([buf], { type: type || 'application/octet-stream' }), name);
  const r = await fetch(`${ASANA_API}/attachments?opt_fields=name,permanent_url`, { method: 'POST', headers: { Authorization: `Bearer ${dec(cfg.asana.pat)}` }, body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.errors?.[0]?.message || `Upload failed (${r.status})`);
  // cache our own image straight away so it shows without downloading it back
  const ext = (name.match(IMAGE)?.[1] || '').toLowerCase();
  if (ext) { const dir = path.join(ATT_ROOT(), taskGid); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${body.data.gid}.${ext}`), buf); }
  return body.data;
}

// ---------- Claude Code bridge ----------
const bridge = bridgeLib.create({
  google: (u, i) => googleFetch(u, i), asana: (p, i) => asanaFetch(p, i), everhour: (p, i) => everhourFetch(p, i),
  getCfg: () => cfg, saveCfg: () => saveCfg(),
  notify: (ch, data) => {
    if (!win) return;
    if (ch === 'open-task') { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    win.webContents.send(ch, data);
  },
});

const run = (exe, args) => new Promise((resolve) => {
  const p = spawn(exe, args, { windowsHide: true });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => resolve({ code: -1, out: e.message }));
  p.on('close', (code) => resolve({ code, out: out.trim() }));
});

// The Command Palette extension is a packaged app: Windows gives it a private copy of AppData, so it can't
// see our config. Put just the local port and key where it can read them (the user's profile, outside AppData).
function writeDockFile(port) {
  try {
    const dir = path.join(app.getPath('home'), '.workmate-desk');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dock.json'), JSON.stringify({ port, token: cfg.mcp.token }));
  } catch (e) { console.error('dock file:', e.message); }
}

// local MCP server on the first free port from 47823; the token keeps other programs out
async function startBridge() {
  cfg.mcp.token ||= crypto.randomBytes(24).toString('hex');
  for (let port = 47823; port < 47843; port++) {
    try { await bridge.start(port, cfg.mcp.token); cfg.mcp.port = port; saveCfg(); writeDockFile(port); bridge.startPolling(); return port; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('No free local port for the Claude Code connection');
}

// register (or re-register) Workmate Desk as an MCP server for every Claude Code session of this Windows user
async function registerWithClaude() {
  const { exe } = await ai.findClaude().catch(() => { throw new Error('Claude Code is not installed on this PC'); });
  for (const old of ['glassdesk', 'workmate-desk']) await run(exe, ['mcp', 'remove', old, '-s', 'user']);
  const r = await run(exe, ['mcp', 'add', '--transport', 'http', '-s', 'user', 'workmate-desk', `http://127.0.0.1:${cfg.mcp.port}/mcp`, '--header', `Authorization: Bearer ${cfg.mcp.token}`]);
  if (r.code !== 0) throw new Error(`Claude Code refused: ${r.out.split('\n').pop()}`);
  cfg.mcp.registeredPort = cfg.mcp.port; saveCfg();
}

// "Work on this in Claude Code": write the task brief into its own folder and open Claude Code there
async function handoffTask(gid) {
  const md = await bridge.taskMarkdown(gid);
  const name = (md.match(/^# (.+)$/m)?.[1] || gid).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const dir = path.join(app.getPath('documents'), 'Workmate Desk', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'TASK.md'), md);
  const { exe } = await ai.findClaude().catch(() => { throw new Error('Claude Code is not installed on this PC'); });
  const prompt = 'Read TASK.md in this folder. It has the full context of my Asana task, including comments, blockers and linked emails. Help me work on it, and use the workmate-desk tools for anything newer.';
  // a tiny launcher avoids every terminal's quoting rules (Windows Terminal splits on ';' and re-quotes args)
  const title = name.replace(/[&|<>^%"]/g, ' ');
  fs.writeFileSync(path.join(dir, 'launch.cmd'), `@echo off\r\ntitle Workmate Desk: ${title}\r\n"${exe}" "${prompt}"\r\n`);
  const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
  if (fs.existsSync(wt)) spawn(wt, ['-w', 'new', '-d', dir, 'cmd', '/k', 'launch.cmd'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd.exe', ['/c', 'start', 'Workmate Desk', '/D', dir, 'cmd', '/k', 'launch.cmd'], { detached: true, stdio: 'ignore' }).unref();
  return dir;
}

// ---------- window ----------
let win;
let quitting = false;
function widgetBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIDGET_SIZE.width - 16, y: wa.y + 16, ...WIDGET_SIZE };
}

const overlayStyle = (widget) => ({
  color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f7' : '#1d1d1f', height: widget ? 44 : 52,
});

function setWidget(on) {
  if (on && !cfg.ui.widget) cfg.ui.bounds = win.getBounds();
  cfg.ui.widget = on;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(...MIN[on ? 'widget' : 'full']);
  win.setBounds(on ? fit(cfg.ui.widgetBounds || widgetBounds(), MIN.widget) : fit(cfg.ui.bounds || { width: 1320, height: 840 }, MIN.full));
  win.setTitleBarOverlay(overlayStyle(on));
  if (!on) win.center();
  saveCfg();
  win.webContents.send('ui:changed', publicCfg().ui);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: MIN.full[0], minHeight: MIN.full[1],
    // opaque in-app wallpaper instead of Windows acrylic: sharp, and no desktop blur for DWM to compute.
    // Native Windows caption buttons (with snap layouts) drawn over our own title bar.
    titleBarStyle: 'hidden', titleBarOverlay: overlayStyle(cfg.ui.widget), show: false,
    backgroundColor: theme().bg === 'transparent' ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#060a1a' : '#dde8ff',
    backgroundMaterial: theme().bg === 'transparent' ? 'acrylic' : 'none',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: true },
  });
  if (cfg.ui.widget) { win.setMinimumSize(...MIN.widget); win.setBounds(fit(cfg.ui.widgetBounds || widgetBounds(), MIN.widget)); }
  win.setAlwaysOnTop(!!cfg.ui.pinned, 'floating');
  nativeTheme.on('updated', () => {
    win.setTitleBarOverlay(overlayStyle(cfg.ui.widget));
    if (theme().bg !== 'transparent') win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#060a1a' : '#dde8ff');
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // remember where the user parks the widget
  // Close button: widget -> back to the full window; full window -> ask (or do the remembered choice).
  // Real quits (Quit in the dialog, Windows shutdown/sign-out) set `quitting` and go straight through.
  win.on('session-end', () => { quitting = true; });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (cfg.ui.widget) return setWidget(false);
    if (cfg.ui.closeAction === 'widget') return setWidget(true);
    if (cfg.ui.closeAction === 'quit') { quitting = true; return app.quit(); }
    if (win.isMinimized()) win.restore();
    win.show();
    win.webContents.send('close-request');
  });

  const keepWidget = () => { if (cfg.ui.widget) { cfg.ui.widgetBounds = win.getBounds(); saveCfg(); } };
  win.on('moved', keepWidget);
  win.on('resized', keepWidget);
  // links inside emails / Asana / Meet open in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------- IPC ----------
const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

handle('config:get', () => publicCfg());

handle('google:connect', async (clientId, clientSecret) => {
  clientId = (clientId || cfg.google.clientId || '').trim();
  clientSecret = (clientSecret || dec(cfg.google.secret) || '').trim();
  if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Client ID should end with .apps.googleusercontent.com');
  if (!clientSecret) throw new Error('Client secret is required');
  const tok = await googleSignIn(clientId, clientSecret);
  if (!tok.refresh_token) throw new Error('Google did not return a refresh token, try again');
  cfg.google = { clientId, secret: enc(clientSecret), refresh: enc(tok.refresh_token), scope: tok.scope };
  access = { token: tok.access_token, exp: Date.now() + tok.expires_in * 1000 };
  cfg.google.email = (await googleFetch('https://openidconnect.googleapis.com/v1/userinfo')).email;
  saveCfg();
  return publicCfg();
});

handle('google:disconnect', () => {
  cfg.google = { clientId: cfg.google.clientId, secret: cfg.google.secret };
  access = { token: '', exp: 0 };
  saveCfg();
  return publicCfg();
});

handle('asana:connect', async (pat) => {
  pat = (pat || '').trim();
  if (!pat) throw new Error('Paste an Asana personal access token');
  const me = (await asanaFetch('/users/me?opt_fields=name,email,workspaces.name', {}, pat)).data;
  cfg.asana = {
    pat: enc(pat), user: { gid: me.gid, name: me.name, email: me.email },
    workspaces: me.workspaces.map((w) => ({ gid: w.gid, name: w.name })), workspaceGid: me.workspaces[0]?.gid || '',
  };
  saveCfg();
  return publicCfg();
});

handle('asana:workspace', (gid) => { cfg.asana.workspaceGid = gid; saveCfg(); return publicCfg(); });
handle('asana:disconnect', () => { cfg.asana = {}; saveCfg(); return publicCfg(); });

handle('ai:connect', async (key) => {
  key = (key || '').trim();
  if (!key) throw new Error('Paste an Anthropic API key');
  await ai.testKey(key);
  cfg.ai = { key: enc(key) };
  saveCfg();
  return publicCfg();
});
// Claude Platform login: reuse an existing `ant` profile, or run `ant auth login` (opens the browser)
handle('ai:platform', async () => {
  try { await ai.testKey(); } catch {
    await new Promise((resolve, reject) => {
      const p = spawn('ant', ['auth', 'login'], { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => { p.kill(); reject(new Error('Claude Platform sign-in timed out')); }, 5 * 60 * 1000);
      p.on('error', () => { clearTimeout(timer); reject(new Error('ANT_MISSING')); });
      p.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Claude Platform sign-in was cancelled')); });
    });
    await ai.testKey();
  }
  cfg.ai = { mode: 'platform' };
  saveCfg();
  return publicCfg();
});
// Claude Code mode: reuse the Claude Code CLI already signed in on this PC
handle('ai:claudecode', async () => {
  const version = await ai.claudeCodeVersion();
  cfg.ai = { mode: 'claude-code', version };
  saveCfg();
  return publicCfg();
});
handle('ai:disconnect', () => { cfg.ai = {}; saveCfg(); return publicCfg(); });

// Saved AI reads, keyed by thread + newest message: an email is only read again when a new message
// arrives in its thread, or when you ask ("Analyse again"). Entries older than 90 days are dropped.
const aiCachePath = () => path.join(app.getPath('userData'), 'ai-cache.json');
let aiCache = null;
const aiStore = () => { if (!aiCache) { try { aiCache = JSON.parse(fs.readFileSync(aiCachePath(), 'utf8')); } catch { aiCache = {}; } } return aiCache; };
function saveAiStore() {
  const cutoff = Date.now() - 90 * 86400000;
  for (const [k, v] of Object.entries(aiCache)) if (!v?.at || v.at < cutoff) delete aiCache[k];
  fs.writeFileSync(aiCachePath(), JSON.stringify(aiCache));
}
handle('ai:save', (key, result) => { if (key && result) { aiStore()[key] = { at: Date.now(), result }; saveAiStore(); } });
handle('ai:cached', (keys) => {
  const c = aiStore();
  return Object.fromEntries((keys || []).filter((k) => c[k]).map((k) => [k, c[k].result]));
});
handle('ai:analyze', async (input) => {
  const key = input.cacheKey, c = aiStore();
  if (key && !input.force && c[key]) return c[key].result; // already read: no Claude call
  if (!publicCfg().ai.connected) throw new Error('AI is not connected');
  const result = cfg.ai.mode === 'claude-code' ? await ai.analyzeWithClaudeCode(input) : await ai.analyzeEmail(cfg.ai.key ? dec(cfg.ai.key) : undefined, input);
  if (key) { c[key] = { at: Date.now(), result }; saveAiStore(); }
  return result;
});

handle('everhour:connect', async (key) => {
  key = (key || '').trim();
  if (!key) throw new Error('Paste your Everhour API key');
  const me = await everhourFetch('/users/me', {}, key);
  cfg.everhour = { key: enc(key), user: { id: me.id, name: me.name } };
  saveCfg();
  return publicCfg();
});
handle('everhour:disconnect', () => { cfg.everhour = {}; saveCfg(); return publicCfg(); });
handle('everhour:fetch', async (p, init) => {
  const r = await everhourFetch(p, init);
  if (p.startsWith('/timers') && init?.method && init.method !== 'GET') bridge.refreshTimer();
  return r;
});

handle('google:fetch', googleFetch);
handle('asana:fetch', (p, init) => asanaFetch(p, init));

handle('links:get', () => cfg.links);
handle('links:set', (threadId, gids) => {
  if (gids.length) cfg.links[threadId] = [...new Set(gids)]; else delete cfg.links[threadId];
  saveCfg();
  return cfg.links;
});

// manual urgency: kind 'threads' (one email) or 'senders' (rule by address); level '' = back to auto
handle('urgency:get', () => cfg.urgency);
handle('urgency:set', (kind, key, level) => {
  if (!['threads', 'senders'].includes(kind) || !['', 'urgent', 'high', 'normal'].includes(level)) throw new Error('Bad urgency value');
  if (level) cfg.urgency[kind][key] = level; else delete cfg.urgency[kind][key];
  saveCfg();
  return cfg.urgency;
});

// muted senders: full addresses or domains, lower-case, no duplicates
handle('filters:get', () => cfg.muted);
handle('filters:set', (list) => {
  cfg.muted = [...new Set(list.map((p) => String(p).trim().toLowerCase()).filter((p) => /^[^\s]+\.[^\s]+$/.test(p)))];
  saveCfg();
  return cfg.muted;
});

handle('open:external', (url) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); });

handle('ui:pin', (on) => { cfg.ui.pinned = on; win.setAlwaysOnTop(on, 'floating'); saveCfg(); return publicCfg().ui; });
handle('ui:widget', (on) => { setWidget(on); return publicCfg().ui; });
function setOpenAtLogin(on) {
  cfg.ui.openAtLogin = on;
  app.setLoginItemSettings({
    openAtLogin: on,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
  saveCfg();
  return publicCfg().ui;
}
handle('ui:openAtLogin', setOpenAtLogin);
handle('win:quit', () => { quitting = true; app.quit(); });
handle('ui:closeAction', (a) => {
  if (!['ask', 'widget', 'quit'].includes(a)) throw new Error('Bad close action');
  cfg.ui.closeAction = a; saveCfg(); return publicCfg().ui;
});
handle('ui:theme', (patch) => {
  const t = { ...theme(), ...patch };
  if (!BGS.includes(t.bg) || !['system', 'light', 'dark'].includes(t.mode)) throw new Error('Bad theme');
  t.dim = Math.max(0, Math.min(80, +t.dim || 0));
  cfg.ui.theme = t; saveCfg(); applyTheme();
  return publicCfg().ui;
});
handle('wallpaper:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a background picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  if (fs.statSync(src).size > 15 * 1024 * 1024) throw new Error('Pick a picture under 15 MB');
  if (cfg.ui.theme?.pic) fs.rmSync(picPath(), { force: true });
  const name = 'wallpaper' + path.extname(src).toLowerCase();
  fs.copyFileSync(src, path.join(app.getPath('userData'), name));
  cfg.ui.theme = { ...theme(), bg: 'picture', pic: name }; saveCfg(); applyTheme();
  return { ui: publicCfg().ui, url: picDataUrl() };
});
handle('wallpaper:get', () => picDataUrl());
handle('mcp:enable', async () => {
  cfg.mcp = { ...(cfg.mcp || {}), enabled: true };
  if (!bridge.running()) await startBridge();
  await registerWithClaude();
  return publicCfg();
});
handle('mcp:disable', async () => {
  cfg.mcp = { ...(cfg.mcp || {}), enabled: false }; saveCfg(); // the local server keeps running for the dock
  const c = await ai.findClaude().catch(() => null);
  if (c) for (const old of ['glassdesk', 'workmate-desk']) await run(c.exe, ['mcp', 'remove', old, '-s', 'user']);
  return publicCfg();
});
handle('handoff:task', (gid) => handoffTask(gid));
handle('asana:attachments', (gid) => taskAttachments(gid));
handle('asana:upload', (gid, file) => uploadAttachment(gid, file));
handle('win:show', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });

// a second launch just brings this window forward
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
// Windows only shows an app's notifications if a Start menu shortcut carries its AppUserModelID
const APP_ID = 'io.workmatedesk.app';
app.setAppUserModelId(APP_ID);
function ensureStartMenuShortcut() {
  const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.rmSync(path.join(dir, 'GlassDesk.lnk'), { force: true }); // shortcut from before the rename
  const lnk = path.join(dir, 'Workmate Desk.lnk');
  shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', { target: process.execPath, appUserModelId: APP_ID });
}

app.whenReady().then(() => {
  loadCfg();
  if (app.isPackaged) ensureStartMenuShortcut();
  nativeTheme.themeSource = theme().mode;
  try { cleanAttachmentCache(); } catch {}
  setInterval(() => { try { cleanAttachmentCache(); } catch {} }, 6 * 3600 * 1000);
  cfg.mcp ||= {};
  // bring the Claude Code connection back up; re-register if the port had to change
  startBridge().then((port) => (cfg.mcp.enabled && port !== cfg.mcp.registeredPort ? registerWithClaude() : null)).catch((e) => console.error('Local bridge:', e.message));
  // start-up app by default for installed builds; the Settings toggle turns it off
  if (app.isPackaged) {
    for (const old of ['electron.app.GlassDesk', 'io.glassdesk.app']) app.setLoginItemSettings({ openAtLogin: false, name: old });
    setOpenAtLogin(cfg.ui.openAtLogin ?? true);
  }
  createWindow();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
