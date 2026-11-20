// Sign-in and API access for mail accounts (Gmail, Outlook via Microsoft Graph), Jira Cloud and Salesforce.
// Runs in the main process; the renderer only ever sees paths and results, never tokens.
const http = require('http');
const crypto = require('crypto');

const GOOGLE_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.modify', // read + change labels (mark as read); cannot send or delete
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');
const MS_SCOPES = 'openid email offline_access User.Read Mail.ReadWrite'; // ReadWrite only to set isRead
const SF_VERSION = 'v62.0';
const SF_PORT = 47890; // Salesforce matches the callback URL exactly, port included
const SF_HOST = /^https:\/\/[a-z0-9.-]+\.(salesforce|force)\.com$/i;
const JIRA_SITE = /^https:\/\/[a-z0-9-]+\.atlassian\.net$/i;
const MAIL_HOSTS = { google: /^[a-z0-9-]+\.googleapis\.com$/i, microsoft: /^graph\.microsoft\.com$/i };

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const withQuery = (base, q) => { const u = new URL(base); Object.entries(q).forEach(([k, v]) => v && u.searchParams.set(k, v)); return u.toString(); };
const noTrail = (s) => String(s || '').trim().replace(/\/+$/, '');

async function tokenPost(url, params, what) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${what}: ${tok.error_description || tok.error || r.status}`); e.code = tok.error; throw e; }
  return tok;
}

// Installed-app sign-in: open the provider's page in the browser, wait for its redirect to this PC, PKCE throughout.
function browserSignIn({ open, name, authUrl, redirectHost = '127.0.0.1', port = 0, path = '/' }) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let redirectUri;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== path) { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        `<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">${ok ? 'Signed in. You can close this tab and return to Workmate Desk.' : 'Sign-in failed. Return to Workmate Desk and try again.'}</body>`);
      server.close(); clearTimeout(timer);
      if (!ok) return reject(new Error(url.searchParams.get('error_description') || url.searchParams.get('error') || `${name} sign-in was cancelled`));
      resolve({ code: url.searchParams.get('code'), verifier, redirectUri });
    });
    const timer = setTimeout(() => { server.close(); reject(new Error(`${name} sign-in timed out`)); }, 5 * 60 * 1000);
    server.once('error', (e) => { clearTimeout(timer); reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is busy; close whatever uses it and try again`) : e); });
    server.listen(port, '127.0.0.1', () => {
      redirectUri = `http://${redirectHost}:${server.address().port}${path === '/' ? '' : path}`;
      open(authUrl(redirectUri, state, challenge));
    });
  });
}

// Before multi-account, the one Gmail sign-in lived in cfg.google, and links, urgency choices and saved
// AI reads were keyed by bare Gmail thread id. Move them under that account. Returns true if anything changed.
function migrate(cfg, aiCache = {}) {
  if (cfg.accounts) return false;
  const g = cfg.google || {};
  cfg.accounts = [];
  if (g.refresh && g.email) {
    const id = `google:${g.email.toLowerCase()}`;
    cfg.accounts.push({ id, provider: 'google', email: g.email, refresh: g.refresh, scope: g.scope });
    const pre = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.includes('|') ? k : `${id}|${k}`, v]));
    cfg.links = pre(cfg.links);
    cfg.urgency = { senders: {}, ...cfg.urgency, threads: pre(cfg.urgency?.threads) };
    for (const k of Object.keys(aiCache)) if (!k.includes('|')) { aiCache[`${id}|${k}`] = aiCache[k]; delete aiCache[k]; }
  }
  cfg.google = { clientId: g.clientId, secret: g.secret };
  return true;
}

function create({ getCfg, saveCfg, enc, dec, open }) {
  const cfg = () => getCfg();
  const access = new Map(); // account id / 'salesforce' -> { token, exp }
  const remember = (key, tok, seconds = tok.expires_in || 3600) => access.set(key, { token: tok.access_token, exp: Date.now() + seconds * 1000 });
  const fresh = (key) => { const c = access.get(key); return c && Date.now() < c.exp - 60_000 ? c.token : ''; };

  // ---------- mail accounts ----------
  const account = (id) => cfg().accounts.find((a) => a.id === id) || (() => { throw new Error('That mail account is no longer connected'); })();
  const msBase = () => `https://login.microsoftonline.com/${cfg().microsoft?.tenant || 'common'}/oauth2/v2.0`;

  async function accountToken(a, force) {
    if (!force && fresh(a.id)) return fresh(a.id);
    let tok;
    try {
      tok = a.provider === 'google'
        ? await tokenPost('https://oauth2.googleapis.com/token', { client_id: cfg().google.clientId, client_secret: dec(cfg().google.secret), refresh_token: dec(a.refresh), grant_type: 'refresh_token' }, a.email)
        : await tokenPost(`${msBase()}/token`, { client_id: cfg().microsoft.clientId, refresh_token: dec(a.refresh), grant_type: 'refresh_token', scope: MS_SCOPES }, a.email);
    } catch (e) {
      if (e.code === 'invalid_grant' && !a.needsReconnect) { a.needsReconnect = true; saveCfg(); }
      throw new Error(`${a.email}: sign-in expired, reconnect it in Settings`);
    }
    if (tok.refresh_token) a.refresh = enc(tok.refresh_token); // Microsoft rotates refresh tokens
    if (a.needsReconnect || tok.refresh_token) { delete a.needsReconnect; saveCfg(); }
    remember(a.id, tok);
    return tok.access_token;
  }

  async function mailFetch(id, url, init = {}, retried) {
    const a = account(id);
    const u = new URL(url);
    if (u.protocol !== 'https:' || !MAIL_HOSTS[a.provider].test(u.hostname)) throw new Error('Blocked URL for this account');
    const r = await fetch(u, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accountToken(a, retried)}` } });
    if (r.status === 401 && !retried) return mailFetch(id, url, init, true);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error?.message || `${a.provider === 'google' ? 'Google' : 'Microsoft'} API ${r.status}`);
    return body;
  }

  // a reconnect of an existing address keeps its place in the list
  function saveAccount(provider, email, tok, scope) {
    if (!email) throw new Error(`${provider === 'google' ? 'Google' : 'Microsoft'} did not say which mailbox you signed in to`);
    const id = `${provider}:${email.toLowerCase()}`;
    const a = { id, provider, email, refresh: enc(tok.refresh_token), scope };
    const list = cfg().accounts, i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = a; else list.push(a);
    remember(id, tok);
    saveCfg();
    return a;
  }

  async function connectGoogle(clientId, clientSecret, hint) {
    clientId = (clientId || cfg().google.clientId || '').trim();
    clientSecret = (clientSecret || dec(cfg().google.secret) || '').trim();
    if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Client ID should end with .apps.googleusercontent.com');
    if (!clientSecret) throw new Error('Client secret is required');
    const { code, verifier, redirectUri } = await browserSignIn({
      open, name: 'Google',
      authUrl: (redirect, state, challenge) => withQuery('https://accounts.google.com/o/oauth2/v2/auth', {
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_SCOPES, code_challenge: challenge,
        code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state, login_hint: hint,
      }),
    });
    const tok = await tokenPost('https://oauth2.googleapis.com/token', {
      client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
    }, 'Google sign-in');
    if (!tok.refresh_token) throw new Error('Google did not return a refresh token, try again');
    cfg().google = { clientId, secret: enc(clientSecret) };
    const me = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    return saveAccount('google', me.email, tok, tok.scope);
  }

  async function connectMicrosoft(clientId, tenant, hint) {
    clientId = (clientId || cfg().microsoft?.clientId || '').trim();
    tenant = (tenant || cfg().microsoft?.tenant || 'common').trim();
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('Application (client) ID looks like 00000000-0000-0000-0000-000000000000');
    if (!/^[\w.-]+$/.test(tenant)) throw new Error('Directory (tenant) ID is a GUID, a domain, or "common"');
    cfg().microsoft = { clientId, tenant };
    const { code, verifier, redirectUri } = await browserSignIn({
      open, name: 'Microsoft', redirectHost: 'localhost', // Entra accepts any port on http://localhost for desktop apps
      authUrl: (redirect, state, challenge) => withQuery(`${msBase()}/authorize`, {
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: MS_SCOPES, code_challenge: challenge,
        code_challenge_method: 'S256', state, prompt: 'select_account', login_hint: hint,
      }),
    });
    const tok = await tokenPost(`${msBase()}/token`, {
      client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri, scope: MS_SCOPES,
    }, 'Microsoft sign-in');
    if (!tok.refresh_token) throw new Error('Microsoft did not return a refresh token; add the offline_access permission to the app');
    const me = await (await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    return saveAccount('microsoft', me.mail || me.userPrincipalName, tok, tok.scope);
  }

  const reconnect = (id) => {
    const a = account(id);
    return a.provider === 'google' ? connectGoogle('', '', a.email) : connectMicrosoft('', '', a.email);
  };
  function removeAccount(id) {
    cfg().accounts = cfg().accounts.filter((a) => a.id !== id);
    access.delete(id);
    saveCfg();
  }

  // ---------- Jira Cloud (email + API token) ----------
  async function jiraFetch(p, init = {}, j = cfg().jira) {
    if (!j?.token) throw new Error('Jira is not connected');
    if (!p.startsWith('/') || p.includes('..')) throw new Error('Bad Jira path');
    const r = await fetch(`${j.site}/rest/api/3${p}`, {
      ...init,
      headers: { ...init.headers, Authorization: 'Basic ' + Buffer.from(`${j.email}:${dec(j.token)}`).toString('base64'), Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.errorMessages?.[0] || Object.values(body.errors || {})[0] || `Jira API ${r.status}`);
    return body;
  }

  async function connectJira(site, email, token) {
    site = noTrail(site).replace(/^(?!https?:\/\/)/i, 'https://');
    if (/^https:\/\/[a-z0-9-]+$/i.test(site)) site += '.atlassian.net'; // just the site name
    email = String(email || '').trim(); token = String(token || '').trim();
    if (!JIRA_SITE.test(site)) throw new Error('Jira site looks like https://your-company.atlassian.net');
    if (!email || !token) throw new Error('Enter your Atlassian email and API token');
    const j = { site, email, token: enc(token) };
    const me = await jiraFetch('/myself', {}, j);
    cfg().jira = { ...j, user: { accountId: me.accountId, name: me.displayName } };
    saveCfg();
  }

  // ---------- Salesforce (OAuth web-server flow with PKCE, no client secret) ----------
  async function sfToken(force) {
    if (!force && fresh('salesforce')) return fresh('salesforce');
    const s = cfg().salesforce;
    if (!s?.refresh) throw new Error('Salesforce is not connected');
    let tok;
    try { tok = await tokenPost(`${s.loginUrl}/services/oauth2/token`, { grant_type: 'refresh_token', refresh_token: dec(s.refresh), client_id: s.clientId }, 'Salesforce'); }
    catch { throw new Error('Salesforce sign-in expired, reconnect it in Settings'); }
    if (tok.instance_url && SF_HOST.test(tok.instance_url)) s.instanceUrl = tok.instance_url;
    remember('salesforce', tok, 50 * 60); // Salesforce sends no expiry; a 401 refreshes early anyway
    return tok.access_token;
  }

  async function sfFetch(p, init = {}, retried) {
    if (!p.startsWith('/') || p.includes('..')) throw new Error('Bad Salesforce path');
    const token = await sfToken(retried); // first: a refresh can move the org to another instance
    const r = await fetch(`${cfg().salesforce.instanceUrl}/services/data/${SF_VERSION}${p}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    if (r.status === 401 && !retried) return sfFetch(p, init, true);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((Array.isArray(body) && body[0]?.message) || `Salesforce API ${r.status}`);
    return body;
  }

  async function connectSalesforce(clientId, loginUrl) {
    clientId = String(clientId || cfg().salesforce?.clientId || '').trim();
    loginUrl = noTrail(loginUrl || 'https://login.salesforce.com').replace(/^(?!https?:\/\/)/i, 'https://');
    if (!clientId) throw new Error('Paste the consumer key of your Salesforce app');
    if (!SF_HOST.test(loginUrl)) throw new Error('Login URL is login.salesforce.com, test.salesforce.com or your My Domain (…my.salesforce.com)');
    const { code, verifier, redirectUri } = await browserSignIn({
      open, name: 'Salesforce', port: SF_PORT, redirectHost: 'localhost', path: '/callback',
      authUrl: (redirect, state, challenge) => withQuery(`${loginUrl}/services/oauth2/authorize`, {
        response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'api refresh_token',
      }),
    });
    const tok = await tokenPost(`${loginUrl}/services/oauth2/token`, {
      grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier,
    }, 'Salesforce sign-in');
    if (!tok.refresh_token) throw new Error('Salesforce returned no refresh token: add the "Perform requests at any time (refresh_token, offline_access)" scope to the app');
    if (!SF_HOST.test(tok.instance_url || '') || !SF_HOST.test(new URL(tok.id).origin)) throw new Error('Salesforce answered from an unexpected address');
    const me = await (await fetch(tok.id, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    cfg().salesforce = { clientId, loginUrl, refresh: enc(tok.refresh_token), instanceUrl: tok.instance_url, user: { id: me.user_id, name: me.display_name || me.username } };
    remember('salesforce', tok, 50 * 60);
    saveCfg();
  }
  function disconnectSalesforce() { cfg().salesforce = { clientId: cfg().salesforce?.clientId, loginUrl: cfg().salesforce?.loginUrl }; access.delete('salesforce'); saveCfg(); }

  return { mailFetch, connectGoogle, connectMicrosoft, reconnect, removeAccount, jiraFetch, connectJira, sfFetch, connectSalesforce, disconnectSalesforce };
}

module.exports = { create, migrate, SF_PORT, SF_VERSION };
