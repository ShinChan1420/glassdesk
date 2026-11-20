/* global api, Urgency, Sources */
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DAY = 86400000;

const S = {
  cfg: null, ui: {}, view: 'mail', fromSettings: false,
  emails: [], tasks: [], events: [], links: {}, urg: { threads: {}, senders: {} }, muted: [], mailNext: {}, acctFilter: '', mailDays: 14, mailMax: 100,
  jira: [], cases: { list: [], q: '', scope: 'mine', sel: null, detail: null, form: null, meta: null, draft: '', ownerQ: '', owners: [] },
  timer: null, ehTime: {}, sections: {}, att: {}, files: [], editing: null, editDraft: '', linkQ: '', taskQ: '', boardQ: '', boardMenu: false, boardOpened: false, defaultBoard: null, utl: null, mySections: [], boards: [], boardSrc: 'my', board: null, taskSel: null, taskDetail: null, draft: '', lastLoad: 0,
  sel: null, bodies: {}, ai: {}, aiPending: new Set(), aiErr: {},
  filter: 'all', q: '', showNoise: false, loading: false,
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calDay: null, calItem: null, showRoutine: true, showHidden: false, hiddenEv: { ids: [], series: [] },
};

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const decodeEntities = (s) => { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; };
const htmlToText = (h) => new DOMParser().parseFromString(h, 'text/html').body.textContent || '';
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a, b) => key(a) === key(b);
const hue = (s) => [...(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n) => (n || '?').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtShort = (d) => {
  const now = new Date();
  if (sameDay(d, now)) return fmtTime(d);
  if (now - d < 6 * DAY) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};
const allTasks = () => [...S.tasks, ...S.jira]; // Asana tasks and Jira issues, same shape
const taskById = (gid) => allTasks().find((t) => t.gid === gid);
const isJira = (gid) => String(gid || '').startsWith('jira:');
const tasksOn = () => S.cfg.asana.connected || S.cfg.jira.connected;
const acctOf = (id) => S.cfg.accounts.find((a) => a.id === id);
const primaryGoogle = () => S.cfg.accounts.find((a) => a.provider === 'google'); // the calendar comes from here
const providerName = (p) => (p === 'microsoft' ? 'Outlook' : 'Gmail');
const dueLabel = (t) => {
  const d = Urgency.daysUntil(t, new Date());
  if (d === null) return 'No due date';
  if (d < 0) return `Overdue ${-d}d`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${Urgency.dueDate(t).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
};
const dueClass = (t) => { const d = Urgency.daysUntil(t, new Date()); return d === null ? '' : d < 0 ? 'overdue' : d <= 1 ? 'soon' : ''; };
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out.filter(Boolean);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

const I = {
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4zM12 14v7"/></svg>',
  widget: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

// ---------- data ----------
function header(msg, name) { return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''; }

// Each account fetches up to `want` threads not in `known` (mail keys), newest first. `cursor` '' = first page.
// next: where to resume ('' or a page token / Graph nextLink), or null when that inbox is exhausted.
// If we stop part-way through a page, we resume from that same page; `known` skips what we already have.
async function fetchGmail(a, want, cursor, known) {
  const q = encodeURIComponent('in:inbox' + (S.mailDays ? ` newer_than:${S.mailDays}d` : ''));
  const picked = [];
  let cur = cursor, next = null;
  for (;;) {
    const list = await api.mail(a.id, `${GMAIL}/messages?maxResults=${Math.min(500, Math.max(50, want * 2))}&q=${q}${cur ? `&pageToken=${cur}` : ''}`);
    let cut = false;
    for (const m of list.messages || []) {
      const k = Sources.mailKey(a.id, m.threadId);
      if (known.has(k)) continue;
      if (picked.length >= want) { cut = true; break; }
      known.add(k); picked.push(m);
    }
    next = cut ? cur : list.nextPageToken || null;
    if (cut || !list.nextPageToken) break;
    cur = list.nextPageToken;
  }
  // ponytail: one metadata call per thread; Gmail's batch endpoint would cut requests if 500+ feels slow
  const meta = await pool(picked, 8, (m) => api.mail(a.id, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`));
  return { emails: meta.map((m) => Sources.gmailEmail(a, m, decodeEntities)), next };
}

const OUTLOOK_FIELDS = 'id,conversationId,from,subject,receivedDateTime,bodyPreview,isRead,importance,flag,inferenceClassification,webLink';
async function fetchOutlook(a, want, cursor, known) {
  const since = S.mailDays ? `&$filter=receivedDateTime ge ${new Date(Date.now() - S.mailDays * DAY).toISOString()}` : '';
  const first = `${GRAPH}/mailFolders/inbox/messages?$top=${Math.min(250, Math.max(50, want * 2))}&$orderby=receivedDateTime desc&$select=${OUTLOOK_FIELDS}${since}`;
  const picked = [];
  let cur = cursor, next = null;
  for (;;) {
    const page = await api.mail(a.id, cur || first);
    let cut = false;
    for (const m of page.value || []) { // newest first, so the first message seen is the conversation's newest
      const k = Sources.mailKey(a.id, m.conversationId);
      if (known.has(k)) continue;
      if (picked.length >= want) { cut = true; break; }
      known.add(k); picked.push(m);
    }
    next = cut ? cur : page['@odata.nextLink'] || null;
    if (cut || !page['@odata.nextLink']) break;
    cur = page['@odata.nextLink'];
  }
  return { emails: picked.map((m) => Sources.outlookEmail(a, m)), next };
}

// every account in parallel, merged newest first; one failing account doesn't empty the inbox
// ponytail: "Load more" takes `want` from every account that has more, not `want` in total
async function fetchMail(want, cursors, known) {
  const rs = await Promise.all(S.cfg.accounts.filter((a) => cursors[a.id] !== null).map((a) =>
    (a.provider === 'microsoft' ? fetchOutlook : fetchGmail)(a, want, cursors[a.id] || '', known)
      .then((r) => ({ id: a.id, ...r }))
      .catch((e) => { toast(`${a.email}: ${clean(e)}`); return { id: a.id, emails: [], next: cursors[a.id] || '' }; })));
  const emails = rs.flatMap((r) => r.emails).sort((x, y) => y.date - x.date);
  const saved = await api.aiCached(emails.map(aiKey)).catch(() => ({}));
  for (const e of emails) {
    const c = saved[aiKey(e)] || store.get('ai:' + e.id);
    if (!c) continue;
    S.ai[aiKey(e)] = c;
    if (!saved[aiKey(e)]) api.aiSave(aiKey(e), c); // move reads saved by older versions into the file
  }
  return { emails, next: Object.fromEntries(rs.map((r) => [r.id, r.next])) };
}

async function loadEmails() {
  // keep however many you've loaded with "Load more" when the app refreshes
  const most = Math.max(S.mailMax, ...S.cfg.accounts.map((a) => S.emails.filter((m) => m.acct === a.id).length));
  const r = await fetchMail(Math.min(1000, most), {}, new Set());
  S.emails = r.emails; S.mailNext = r.next;
}

const DEP_FIELDS = ['name', 'completed', 'assignee.name', 'permalink_url'];
const TASK_FIELDS = ['name,due_on,due_at,notes,permalink_url,modified_at,projects.name,assignee_section.name,assignee.name,assignee.gid,parent.name,parent.projects.name,custom_fields.name,custom_fields.enum_value.name,custom_fields.enum_value.color',
  ...DEP_FIELDS.map((f) => `dependencies.${f}`), ...DEP_FIELDS.map((f) => `dependents.${f}`)].join(',');
const openDeps = (list) => (list || []).filter((d) => !d.completed);
const taskUrl = (t) => t.permalink_url || `https://app.asana.com/0/0/${t.gid}/f`;

// ponytail: stops at maxPages*100 items; raise maxPages if someone has more
async function asanaAll(path, maxPages = 20) {
  let out = [], offset = '';
  for (let i = 0; i < maxPages; i++) {
    const r = await api.asana(`${path}${path.includes('?') ? '&' : '?'}limit=100${offset ? '&offset=' + offset : ''}`);
    out = out.concat(r.data);
    offset = r.next_page?.offset;
    if (!offset) break;
  }
  return out;
}

// every incomplete task in the user's My Tasks list, in My Tasks order
async function loadTasks() {
  const ws = S.cfg.asana.workspaceGid;
  if (!S.cfg.asana.connected || !ws) { S.tasks = []; S.boards = []; return; }
  if (!S.utl) S.utl = (await api.asana(`/users/me/user_task_list?workspace=${ws}`)).data.gid;
  const [tasks, mySecs] = await Promise.all([
    asanaAll(`/user_task_lists/${S.utl}/tasks?completed_since=now&opt_fields=${TASK_FIELDS}`),
    api.asana(`/projects/${S.utl}/sections?opt_fields=name`).catch(() => ({ data: [] })),
  ]);
  S.tasks = tasks;
  S.tasksLoaded = true;
  S.mySections = mySecs.data;
  // every board I have an open task on, busiest first
  const boards = new Map();
  for (const t of tasks) for (const p of boardsOf(t)) {
    const b = boards.get(p.gid) || { gid: p.gid, name: p.name, n: 0 };
    b.n++; boards.set(p.gid, b);
  }
  S.boards = [...boards.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

// a subtask has no project of its own; it lives on its parent's board
const boardsOf = (t) => (t.projects?.length ? t.projects : t.parent?.projects || []);

async function loadBoard(src) {
  S.boardSrc = src;
  if (src === 'my' || src === 'jira') { renderTasks(); return; }
  S.board = { src, loading: true, columns: [] };
  renderTasks();
  try {
    const [secs, tasks] = await Promise.all([
      api.asana(`/projects/${src}/sections?opt_fields=name`),
      asanaAll(`/projects/${src}/tasks?completed_since=now&opt_fields=${TASK_FIELDS},memberships.section.gid,memberships.project.gid`),
    ]);
    const cols = secs.data.map((s) => ({ gid: s.gid, name: s.name, tasks: [] }));
    const byGid = new Map(cols.map((c) => [c.gid, c]));
    // only my tasks, plus other people's tasks that block mine or wait on mine
    const me = S.cfg.asana.user?.gid;
    const mine = new Set(S.tasks.map((t) => t.gid));
    const colOf = new Map(), placed = new Set();
    for (const t of tasks) {
      const col = byGid.get(t.memberships?.find((m) => m.project?.gid === src)?.section?.gid);
      if (col) colOf.set(t.gid, col);
      const isMine = t.assignee?.gid === me || mine.has(t.gid);
      t.blocksMe = !isMine && (t.dependents || []).some((d) => mine.has(d.gid));
      t.waitsOnMe = !isMine && (t.dependencies || []).some((d) => mine.has(d.gid));
      if (col && (isMine || t.blocksMe || t.waitsOnMe)) { col.tasks.push(t); placed.add(t.gid); }
    }
    // my subtasks go in their parent's column (the project endpoint only lists top-level tasks)
    for (const t of S.tasks) if (!placed.has(t.gid) && t.parent && colOf.has(t.parent.gid)) colOf.get(t.parent.gid).tasks.push(t);
    if (S.boardSrc === src) S.board = { src, loading: false, columns: cols };
  } catch (e) { toast(clean(e)); S.board = { src, loading: false, columns: [] }; }
  if (S.boardSrc === src) renderTasks();
}

// My Tasks board: the user's own sections, in their order
function myColumns() {
  const cols = new Map(S.mySections.map((s) => [s.gid, { gid: s.gid, name: s.name, tasks: [] }]));
  for (const t of S.tasks) {
    const s = t.assignee_section || { gid: 'none', name: 'Untitled section' };
    if (!cols.has(s.gid)) cols.set(s.gid, { gid: s.gid, name: s.name, tasks: [] });
    cols.get(s.gid).tasks.push(t);
  }
  return [...cols.values()];
}

function calRange() {
  const g = calGrid(S.calMonth);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(Math.min(g[0], today));
  const to = new Date(Math.max(+g[41] + DAY, +today + 3 * DAY));
  return [from, to];
}

async function loadEvents() {
  const g = primaryGoogle();
  if (!g) { S.events = []; return; }
  const [from, to] = calRange();
  const r = await api.mail(g.id, `${GCAL}?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}`);
  S.events = (r.items || []).filter((e) => e.status !== 'cancelled');
}

const b64 = (d) => d.replace(/-/g, '+').replace(/_/g, '/');
const decodePart = (d) => new TextDecoder().decode(Uint8Array.from(atob(b64(d)), (c) => c.charCodeAt(0)));
const partHeader = (p, name) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

// The whole conversation, oldest first, with every picture as a data: URL:
// inline ones (cid:, e.g. signatures and pasted screenshots) and picture attachments.
async function gmailThread(email) {
  const th = await api.mail(email.acct, `${GMAIL}/threads/${email.threadId}?format=full`);
  let budget = 30; // ponytail: at most 30 pictures (5 MB each) per thread
  return Promise.all(th.messages.map(async (m) => {
    const msg = { id: m.id, from: header(m, 'From'), date: new Date(+m.internalDate), snippet: decodeEntities(m.snippet), html: '', text: '', images: [] };
    const walk = (p) => {
      if (!p) return;
      if (p.mimeType?.startsWith('image/')) msg.images.push({ part: p, cid: partHeader(p, 'Content-ID').replace(/[<>]/g, ''), name: p.filename || 'image' });
      else if (p.body?.data && !p.filename) {
        if (p.mimeType === 'text/html' && !msg.html) msg.html = decodePart(p.body.data);
        if (p.mimeType === 'text/plain' && !msg.text) msg.text = decodePart(p.body.data);
      }
      (p.parts || []).forEach(walk);
    };
    walk(m.payload);
    await Promise.all(msg.images.map(async (im) => {
      if (budget-- <= 0 || (im.part.body?.size || 0) > 5 * 1024 * 1024) return;
      let data = im.part.body?.data;
      if (!data && im.part.body?.attachmentId) data = (await api.mail(email.acct, `${GMAIL}/messages/${m.id}/attachments/${im.part.body.attachmentId}`).catch(() => ({}))).data;
      if (data) im.url = `data:${im.part.mimeType};base64,${b64(data)}`;
    }));
    return msg;
  }));
}

const odataStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
async function outlookThread(email) {
  // no $orderby: Graph rejects it together with a conversationId filter
  const r = await api.mail(email.acct, `${GRAPH}/messages?$filter=conversationId eq ${odataStr(email.threadId)}&$select=id,from,receivedDateTime,bodyPreview,body,hasAttachments&$top=50`);
  const list = (r.value || []).sort((x, y) => new Date(x.receivedDateTime) - new Date(y.receivedDateTime));
  let budget = 30;
  return Promise.all(list.map(async (m) => {
    const body = m.body || {};
    const msg = { id: m.id, from: Sources.addrLine(m.from), date: new Date(m.receivedDateTime), snippet: m.bodyPreview || '', html: body.contentType === 'html' ? body.content : '', text: body.contentType === 'text' ? body.content : '', images: [] };
    if (!m.hasAttachments && !msg.html.includes('cid:')) return msg;
    const base = `${GRAPH}/messages/${encodeURIComponent(m.id)}/attachments`;
    const att = await api.mail(email.acct, `${base}?$select=id,name,contentType,size,isInline`).catch(() => ({ value: [] }));
    await Promise.all(att.value.filter((x) => x.contentType?.startsWith('image/') && x.size <= 5 * 1024 * 1024 && budget-- > 0).map(async (x) => {
      const f = await api.mail(email.acct, `${base}/${encodeURIComponent(x.id)}`).catch(() => null);
      if (f?.contentBytes) msg.images.push({ cid: (f.contentId || '').replace(/[<>]/g, ''), name: x.name || 'image', url: `data:${x.contentType};base64,${f.contentBytes}` });
    }));
    return msg;
  }));
}

async function loadBody(email) {
  const k = aiKey(email); // newest message: a new reply loads the thread again
  if (S.bodies[k]) return S.bodies[k];
  const messages = await (email.provider === 'microsoft' ? outlookThread : gmailThread)(email);
  if (!messages.length) throw new Error('This conversation is empty or was moved');
  const last = messages[messages.length - 1];
  const body = { messages, text: last.text || htmlToText(last.html) }; // the AI reads the newest message
  S.bodies[k] = body;
  const ids = Object.keys(S.bodies);
  if (ids.length > 15) delete S.bodies[ids[0]]; // keep memory flat
  return body;
}

// ---------- conversation view ----------
// Split a message into what's new and the quoted history (Gmail, Outlook web/desktop, Apple Mail, Yahoo, Thunderbird).
const QUOTE_SEL = '.gmail_quote, .gmail_attr, blockquote[type="cite"], #divRplyFwdMsg, #appendonsend, .yahoo_quoted, [id^="OLK_SRC_BODY_SECTION"], .moz-cite-prefix, .OutlookMessageHeader';
function splitHtml(html, images) {
  for (const im of images) if (im.cid && im.url) html = html.split(`cid:${im.cid}`).join(im.url);
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: nothing runs
  const styles = [...doc.querySelectorAll('style')].map((x) => x.outerHTML).join('');
  const root = doc.body;
  root.querySelectorAll('img[src^="cid:"]').forEach((img) => img.remove()); // embedded picture we couldn't fetch: no broken-image icon
  let start = root.querySelector(QUOTE_SEL);
  // Outlook desktop has no class: a short block starting "From:" with "Sent:"/"Date:" in it
  if (!start) start = [...root.querySelectorAll('div, p')].find((el) => /^\s*From:\s/.test(el.textContent) && /\b(Sent|Date):\s/.test(el.textContent) && el.textContent.length < 700);
  // Outlook puts a divider line right above its quoted block: hide it with the quote
  while (start?.previousElementSibling?.tagName === 'HR' || (start && start.previousElementSibling?.tagName === 'BR' && start.previousElementSibling.previousElementSibling?.tagName === 'HR')) start = start.previousElementSibling;
  let quoted = '';
  if (start) {
    const r = doc.createRange();
    r.setStartBefore(start); r.setEndAfter(root.lastChild);
    const holder = doc.createElement('div'); holder.append(r.extractContents()); quoted = holder.innerHTML;
  }
  return { styles, main: root.innerHTML, quoted };
}
function splitText(text) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l, i) => /^On .{5,200}wrote:\s*$/.test(l) || (/^On .{5,200}/.test(l) && /wrote:\s*$/.test(lines[i + 1] || ''))
    || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || (/^From:\s/.test(l) && lines.slice(i + 1, i + 5).some((x) => /^(Sent|Date):\s/.test(x)))
    || (/^>/.test(l) && lines.slice(i).filter((x) => x.trim()).every((x) => /^>/.test(x))));
  const pre = (t) => `<pre>${esc(t.replace(/\s+$/, ''))}</pre>`;
  return cut < 0 ? { styles: '', main: pre(text), quoted: '' } : { styles: '', main: pre(lines.slice(0, cut).join('\n')), quoted: pre(lines.slice(cut).join('\n')) };
}

function threadDoc(body) {
  const msgs = [...body.messages].reverse(); // newest first, like Apple Mail
  const blocks = msgs.map((m, i) => {
    const part = m.html ? splitHtml(m.html, m.images) : splitText(m.text || m.snippet);
    const inline = new Set(m.images.filter((im) => im.cid && (m.html || '').includes(`cid:${im.cid}`)).map((im) => im));
    const gallery = m.images.filter((im) => im.url && !inline.has(im));
    const name = m.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || m.from;
    const addr = (m.from.match(/<([^>]+)>/) || [, m.from])[1];
    return `${part.styles}<details class="gd-msg" ${i === 0 ? 'open' : ''}>
      <summary><span class="gd-av" style="background:hsl(${hue(addr.toLowerCase())} 60% 52%)">${esc(initials(name))}</span>
        <span class="gd-who"><b>${esc(name)}</b><span class="gd-when">${m.date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
        <span class="gd-snip">${esc(m.snippet)}</span></summary>
      <div class="gd-body">${part.main}
        ${gallery.length ? `<div class="gd-gallery">${gallery.map((im) => `<img src="${im.url}" alt="${esc(im.name)}" title="${esc(im.name)}">`).join('')}</div>` : ''}
        ${part.quoted ? `<details class="gd-quoted"><summary title="Show quoted text">•••</summary>${part.quoted}</details>` : ''}
      </div></details>`;
  }).join('');
  const css = `<style>
    html,body{margin:0}body{font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",sans-serif;color:#1d1d1f;word-wrap:break-word;background:#fff}
    img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit;margin:0}
    .gd-msg{border-bottom:1px solid #ececf0}
    .gd-msg>summary{list-style:none;display:grid;grid-template-columns:34px auto 1fr;align-items:center;gap:10px;padding:12px 18px;cursor:pointer}
    .gd-msg>summary::-webkit-details-marker{display:none}
    .gd-msg>summary:hover{background:#f6f6f8}
    .gd-av{width:34px;height:34px;border-radius:50%;color:#fff;display:grid;place-items:center;font:600 12px -apple-system,"Segoe UI",sans-serif}
    .gd-who{display:flex;flex-direction:column;min-width:0}.gd-who b{font-weight:600}
    .gd-when{font-size:12px;color:#8e8e93}
    .gd-snip{color:#6e6e73;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gd-msg[open]>summary .gd-snip{visibility:hidden}
    .gd-body{padding:0 18px 16px 62px}
    .gd-gallery{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.gd-gallery img{max-height:220px;border-radius:8px;border:1px solid #ececf0}
    .gd-quoted{margin-top:10px}
    .gd-quoted>summary{display:inline-block;list-style:none;cursor:pointer;padding:0 8px;border-radius:6px;background:#efeff4;color:#6e6e73;font-weight:700;letter-spacing:1px;line-height:18px}
    .gd-quoted>summary::-webkit-details-marker{display:none}
    .gd-quoted[open]>summary{margin-bottom:8px}
    .gd-quoted>div,.gd-quoted>blockquote,.gd-quoted>pre{border-left:3px solid #d6d6de;padding-left:10px;color:#555}
    .gd-count{padding:10px 18px;font-size:12px;color:#8e8e93;border-bottom:1px solid #ececf0}
  </style>`;
  return `<meta charset="utf-8"><base target="_blank">${css}${msgs.length > 1 ? `<div class="gd-count">${msgs.length} messages in this conversation · newest first</div>` : ''}${blocks}`;
}

async function loadAll() {
  if (S.loading) return;
  S.loading = true; S.lastLoad = Date.now(); renderTitlebar();
  const jobs = [loadEmails(), loadEvents(), loadTasks(), loadJira(), loadTimer(), S.cfg.salesforce.connected && S.cases.loaded ? loadCases() : null];
  (await Promise.allSettled(jobs)).forEach((r) => r.status === 'rejected' && toast(clean(r.reason)));
  S.loading = false;
  rescore(); render();
  // Tasks opened before boards loaded fell back to My Tasks: move to the real home board unless you picked one
  if (S.view === 'tasks' && S.boardSrc === 'my' && !S.pickedBoard && homeBoard() !== 'my') loadBoard(homeBoard());
  checkNotices();
  backgroundAnalyze();
}

// ---------- urgency + linking ----------
const linkedTasks = (m) => (S.links[m.key] || []).map(taskById).filter(Boolean);

function relatedTasks(m) {
  const out = new Map();
  linkedTasks(m).forEach((t) => out.set(t.gid, t));
  (S.ai[aiKey(m)]?.suggestions || []).filter((s) => s.confidence === 'high').forEach((s) => { const t = taskById(s.task_gid); if (t) out.set(t.gid, t); });
  if (Urgency.isAsanaNotification(m.from)) Urgency.matchTasks(m, S.tasks).forEach((t) => out.set(t.gid, t));
  return [...out.values()];
}

const evStart = (e) => new Date(e.start.dateTime || e.start.date + 'T00:00:00');
const evEnd = (e) => new Date(e.end.dateTime || e.end.date + 'T00:00:00');

function rescore() {
  const now = new Date();
  const soon = new Set();
  for (const e of S.events) {
    const st = evStart(e);
    if (st > now && st - now < DAY) (e.attendees || []).forEach((a) => !a.self && soon.add(a.email.toLowerCase()));
  }
  for (const m of S.emails) {
    const auto = Urgency.scoreEmail(m, { linkedTasks: relatedTasks(m), meetingSoonWith: soon, ai: S.ai[aiKey(m)], now });
    m.u = Urgency.applyOverride(auto, S.urg.threads[m.key], S.urg.senders[m.fromAddr]);
  }
}

function signalGids() {
  const s = new Set(Object.values(S.links).flat());
  for (const m of S.emails) relatedTasks(m).forEach((t) => s.add(t.gid));
  return s;
}

async function setLinks(key, gids) {
  S.links = await api.setLinks(key, gids);
  rescore(); refreshPanes();
}

const aiKey = (m) => `${m.key}:${m.id}`; // account + thread + newest message: a new reply means a fresh read

async function analyze(email, force) {
  const k = aiKey(email);
  if (!S.cfg.ai.connected || S.aiPending.has(k) || (!force && S.ai[k])) return;
  S.aiPending.add(k); delete S.aiErr[k];
  refreshPanes();
  try {
    const body = await loadBody(email);
    // ponytail: AI sees the 150 most time-relevant tasks, not all of them, to keep each call small
    const far = 8.64e15;
    const aiTasks = allTasks().sort((a, b) => (Urgency.dueDate(a) || far) - (Urgency.dueDate(b) || far)).slice(0, 150);
    S.ai[k] = await api.analyze({
      email: { from: email.from, date: email.date.toString(), subject: email.subject, body: body.text },
      tasks: aiTasks, today: new Date().toDateString(), cacheKey: k, force: !!force,
    });
  } catch (e) { S.aiErr[k] = clean(e); }
  S.aiPending.delete(k);
  rescore(); refreshPanes();
}

// AI pre-reads the newest unread emails so urgency is known before you open them.
function backgroundAnalyze() {
  if (!S.cfg.ai.connected) return;
  const todo = heads(S.emails).filter((m) => m.labelIds.includes('UNREAD') && !S.ai[aiKey(m)] && !isNoise(m)
    && !m.labelIds.some((l) => /CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)/.test(l))).slice(0, 8);
  pool(todo, S.cfg.ai.mode === 'claude-code' ? 1 : 2, (m) => analyze(m)); // one Claude Code process at a time keeps the PC light
}

// ---------- titlebar ----------
function renderTitlebar() {
  const setup = S.view === 'setup';
  const w = S.ui.widget && !setup;
  $('#titlebar').innerHTML = `
    <div class="tb-app" title="Workmate Desk"><span class="tb-icon">${I.spark}</span>${w ? '' : 'Workmate Desk'}</div>
    ${w || setup ? '<div></div>' : `
    <div class="seg" role="tablist">
      <button class="${S.view === 'mail' ? 'on' : ''}" data-action="tab" data-tab="mail">Mail</button>
      <button class="${S.view === 'calendar' ? 'on' : ''}" data-action="tab" data-tab="calendar">Calendar</button>
      <button class="${S.view === 'tasks' ? 'on' : ''}" data-action="tab" data-tab="tasks">Tasks</button>
      ${S.cfg.salesforce.connected ? `<button class="${S.view === 'cases' ? 'on' : ''}" data-action="tab" data-tab="cases">Cases</button>` : ''}
    </div>`}
    <div class="tb-actions">
      ${S.timer && !setup ? `<button class="timer-pill" ${timerGid() ? `data-action="goto-task" data-gid="${esc(timerGid())}"` : ''} title="Tracking in Everhour: ${esc(S.timer.task?.name)}">
          <span class="rec"></span><span class="timer-txt">${fmtClock(elapsed())}</span>${w ? '' : `<span class="tp-name">${esc(S.timer.task?.name || 'Timer')}</span>`}</button>
        <button class="icon" data-action="timer-stop" title="Stop Everhour timer">${I.stop}</button>` : ''}
      ${setup ? '' : `<button class="icon ${S.loading ? 'spin' : ''}" data-action="refresh" title="Refresh">${I.refresh}</button>`}
      <button class="icon ${S.ui.pinned ? 'on' : ''}" data-action="pin" title="${S.ui.pinned ? 'Unpin from top' : 'Keep on top'}">${I.pin}</button>
      ${setup ? '' : `<button class="icon ${w ? 'on' : ''}" data-action="widget" title="${w ? 'Full window' : 'Desktop widget'}">${w ? I.expand : I.widget}</button>`}
      ${setup || w ? '' : `<button class="icon" data-action="settings" title="Settings">${I.gear}</button>`}
    </div>`;
}

// ---------- setup ----------
function appearanceCard() {
  const t = S.ui.theme || { bg: 'aurora', mode: 'system', dim: 35 };
  return `<div class="card glass">
    <div class="card-head"><span class="badge look">${I.spark}</span><div><h2>Appearance</h2><p>Background and light or dark mode. Changes apply straight away.</p></div></div>
    <div class="swatches">${BG_CHOICES.map(([v, l]) => `<button class="swatch ${t.bg === v ? 'on' : ''}" data-action="${v === 'picture' && !S.pic ? 'pick-wallpaper' : 'set-bg'}" data-bg="${v}">
      <span class="sw-prev sw-${v}" ${v === 'picture' && S.pic ? `style="background-image:url('${S.pic}')"` : ''}>${v === 'picture' && !S.pic ? '+' : ''}</span><span>${l}</span></button>`).join('')}</div>
    ${t.bg === 'picture' && S.pic ? `<div class="row"><label class="lbl inline">Dim the picture<input type="range" id="pic-dim" min="0" max="80" value="${t.dim}"></label><button class="btn ghost tiny" data-action="pick-wallpaper">Choose another picture</button></div>` : ''}
    ${t.bg === 'transparent' ? '<p class="hint">Shows your desktop through frosted glass. Needs Windows 11; on Windows 10 the window stays solid.</p>' : ''}
    <div class="row"><span class="muted">Mode</span><div class="seg mini">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="${t.mode === v ? 'on' : ''}" data-action="set-mode" data-mode="${v}">${l}</button>`).join('')}</div></div>
  </div>`;
}

function accountsCard() {
  const g = S.cfg.google, ms = S.cfg.microsoft, list = S.cfg.accounts;
  return `<div class="card glass">
      <div class="card-head"><span class="badge g">✉</span><div><h2>Mail accounts</h2><p>Gmail and Outlook in one inbox, as many accounts as you like. Calendar comes from your first Gmail account.</p></div>
        ${list.length ? `<span class="status ok">${list.length} connected</span>` : '<span class="status">Required</span>'}</div>
      ${list.map((a) => `<div class="row acct-row"><span><span class="src ${a.provider}">${providerName(a.provider)}</span> <b>${esc(a.email)}</b>
          ${a.needsReconnect ? '<span class="chip red">Sign-in expired</span>' : !a.canModify ? '<span class="chip orange">Reconnect to mark mail read</span>' : ''}</span>
        <span class="acct-btns"><button class="btn ghost tiny" data-action="acct-reconnect" data-id="${esc(a.id)}">Reconnect</button><button class="btn ghost tiny" data-action="acct-remove" data-id="${esc(a.id)}">Disconnect</button></span></div>`).join('')}

      <div class="sub">Add a Gmail account</div>
      <details class="help" ${S.fromSettings || g.hasSecret ? '' : 'open'}><summary>Step by step: get a Google client ID (about 5 minutes, once per company)</summary>
        <p class="hint">Already have one? If a colleague or your IT admin set Workmate Desk up before, ask them for the client ID and secret and jump to step 6. One pair works for the whole company.</p>
        <ol class="steps">
        <li>Sign in to <a href="#" data-action="open-link" data-url="https://console.cloud.google.com/projectcreate">Google Cloud Console</a> with your work Google account and create a project. Any name works, for example <i>Workmate Desk</i>.</li>
        <li>Turn on the two APIs Workmate Desk uses. Open <a href="#" data-action="open-link" data-url="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</a> and click <b>Enable</b>, then open <a href="#" data-action="open-link" data-url="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Google Calendar API</a> and click <b>Enable</b>.</li>
        <li>Open <a href="#" data-action="open-link" data-url="https://console.cloud.google.com/auth/overview">Google Auth Platform</a> and click <b>Get started</b>. Enter <i>Workmate Desk</i> as the app name and your email as the support email. For <b>Audience</b> choose <b>Internal</b>, so only people in your Workspace can use it and Google doesn't need to review it. (Personal Gmail can't pick Internal: choose External, then add your own address under Audience → Test users.)</li>
        <li>Go to <a href="#" data-action="open-link" data-url="https://console.cloud.google.com/auth/clients/create">Clients → Create client</a>. Set <b>Application type</b> to <b>Desktop app</b>, name it <i>Workmate Desk</i> and click <b>Create</b>.</li>
        <li>A box shows the <b>Client ID</b> (ends in <code>.apps.googleusercontent.com</code>) and the <b>Client secret</b> (starts with <code>GOCSPX-</code>). Copy both.</li>
        <li>Paste them below and click <b>Sign in with Google</b>. Your browser opens: pick your account and click <b>Allow</b>. If Google warns the app isn't verified, that's your own app: click <b>Advanced</b>, then <b>Go to Workmate Desk</b>.</li>
        <li>Come back here. The account appears in the list above. Repeat step 6 for each extra Gmail account.</li>
        </ol>
        <p class="hint">Older Google Cloud screens call steps 3 and 4 <i>OAuth consent screen</i> and <i>Credentials → Create credentials → OAuth client ID</i>.</p></details>
      <label class="lbl">Client ID<input class="field" id="g-id" value="${esc(g.clientId)}" placeholder="1234-abc.apps.googleusercontent.com" spellcheck="false"></label>
      <label class="lbl">Client secret<input class="field" id="g-secret" type="password" placeholder="${g.hasSecret ? 'Saved (leave blank to keep)' : 'GOCSPX-…'}" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="google-connect">Sign in with Google</button></div>

      <div class="sub">Add an Outlook / Microsoft 365 account</div>
      <details class="help" ${ms.clientId ? '' : 'open'}><summary>Step by step: register Workmate Desk with Microsoft (about 5 minutes, once per company)</summary>
        <p class="hint">Your IT admin may already have done this: ask for the application (client) ID and directory (tenant) ID and jump to step 5.</p>
        <ol class="steps">
        <li>Open <a href="#" data-action="open-link" data-url="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Entra admin center → App registrations</a> and click <b>New registration</b>. Name it <i>Workmate Desk</i>.</li>
        <li>Under <b>Supported account types</b> pick <b>Accounts in this organizational directory only</b>. Under <b>Redirect URI</b> pick <b>Public client/native (mobile &amp; desktop)</b> and enter <code>http://localhost</code>. Click <b>Register</b>.</li>
        <li>Open <b>API permissions</b> → <b>Add a permission</b> → <b>Microsoft Graph</b> → <b>Delegated permissions</b>, tick <b>Mail.ReadWrite</b>, <b>User.Read</b> and <b>offline_access</b>, and click <b>Add permissions</b>. If your organisation requires it, an admin clicks <b>Grant admin consent</b>.</li>
        <li>On <b>Overview</b>, copy the <b>Application (client) ID</b> and the <b>Directory (tenant) ID</b>.</li>
        <li>Paste them below and click <b>Sign in with Microsoft</b>. Pick your account in the browser and accept.</li>
        </ol>
        <p class="hint">Mail.ReadWrite is only used to mark mail read. Workmate Desk never sends, moves or deletes mail.</p></details>
      <label class="lbl">Application (client) ID<input class="field" id="ms-id" value="${esc(ms.clientId)}" placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></label>
      <label class="lbl">Directory (tenant) ID<input class="field" id="ms-tenant" value="${esc(ms.tenant)}" placeholder="Tenant ID, or common for personal Outlook.com" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="ms-connect">Sign in with Microsoft</button></div>
    </div>`;
}

function jiraCard() {
  const j = S.cfg.jira;
  return `<div class="card glass">
      <div class="card-head"><span class="badge jira">J</span><div><h2>Jira</h2><p>Issues assigned to you, alongside your Asana tasks</p></div>
        ${j.connected ? '<span class="status ok">Connected</span>' : '<span class="status">Optional</span>'}</div>
      ${j.connected ? `<div class="row"><span>Signed in to <b>${esc(j.site.replace('https://', ''))}</b> as <b>${esc(j.user?.name)}</b></span><button class="btn ghost" data-action="jira-disconnect">Disconnect</button></div>` : `
      <details class="help" ${S.fromSettings ? '' : 'open'}><summary>Step by step: connect Jira Cloud (1 minute)</summary><ol class="steps">
        <li>Open <a href="#" data-action="open-link" data-url="https://id.atlassian.com/manage-profile/security/api-tokens">Atlassian API tokens</a> and click <b>Create API token</b>. Name it <i>Workmate Desk</i> and copy it.</li>
        <li>Enter your Jira site (the address you open Jira at), your Atlassian email and the token below, then click <b>Connect Jira</b>.</li>
        </ol><p class="hint">The token acts as you: comments and status changes you make here appear in Jira under your name.</p></details>
      <label class="lbl">Jira site<input class="field" id="j-site" value="${esc(j.site)}" placeholder="your-company.atlassian.net" spellcheck="false"></label>
      <label class="lbl">Atlassian email<input class="field" id="j-email" value="${esc(j.email)}" spellcheck="false"></label>
      <label class="lbl">API token<input class="field" id="j-token" type="password" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="jira-connect">Connect Jira</button></div>`}
    </div>`;
}

function salesforceCard() {
  const sf = S.cfg.salesforce;
  return `<div class="card glass">
      <div class="card-head"><span class="badge sf">☁</span><div><h2>Salesforce</h2><p>Search, update and comment on Cases</p></div>
        ${sf.connected ? '<span class="status ok">Connected</span>' : '<span class="status">Optional</span>'}</div>
      ${sf.connected ? `<div class="row"><span>Signed in as <b>${esc(sf.user?.name)}</b> on ${esc(sf.instanceUrl.replace('https://', ''))}</span><button class="btn ghost" data-action="sf-disconnect">Disconnect</button></div>` : `
      <details class="help" ${S.fromSettings || sf.clientId ? '' : 'open'}><summary>Step by step: set up Salesforce (admin, about 10 minutes, once per company)</summary>
        <p class="hint">Your Salesforce admin does steps 1 to 3 once; then everyone only needs the consumer key.</p>
        <ol class="steps">
        <li>In Salesforce Setup, open <b>App Manager</b> and create a <b>New External Client App</b> (or <b>New Connected App</b> in older orgs) named <i>Workmate Desk</i>.</li>
        <li>Turn on OAuth. Set the callback URL to <code>http://localhost:${sf.port}/callback</code> and add the scopes <b>Manage user data via APIs (api)</b> and <b>Perform requests at any time (refresh_token, offline_access)</b>.</li>
        <li>Tick <b>Require Proof Key for Code Exchange (PKCE)</b>, untick <b>Require secret for Web Server Flow</b> and <b>Require secret for Refresh Token Flow</b>, and save. Copy the <b>Consumer Key</b>. A new app can take up to 10 minutes to start working.</li>
        <li>Paste the consumer key below. Leave the login URL as is, or use <code>test.salesforce.com</code> for a sandbox or your My Domain address. Click <b>Sign in with Salesforce</b>.</li>
        </ol></details>
      <label class="lbl">Consumer key<input class="field" id="sf-id" value="${esc(sf.clientId)}" spellcheck="false"></label>
      <label class="lbl">Login URL<input class="field" id="sf-login" value="${esc(sf.loginUrl || 'https://login.salesforce.com')}" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="sf-connect">Sign in with Salesforce</button></div>`}
    </div>`;
}

function renderSetup() {
  const a = S.cfg.asana, ai = S.cfg.ai;
  return `<section class="setup">
    <div class="hero">
      <div class="app-icon">${I.spark}</div>
      <h1>${S.fromSettings ? 'Settings' : 'Welcome to Workmate Desk'}</h1>
      <p>${S.fromSettings ? 'Your connections. Keys stay on this PC, encrypted by Windows.' : 'Setup takes about 10 minutes and you only do it once. You need one Gmail or Outlook account; Asana, Jira, Salesforce, Everhour and the AI assistant are optional. Every key stays on this PC, encrypted by Windows.'}</p>
    </div>

    ${accountsCard()}

    <div class="card glass">
      <div class="card-head"><span class="badge a">a</span><div><h2>Asana</h2><p>Your open tasks, due dates and links</p></div>
        ${a.connected ? '<span class="status ok">Connected</span>' : '<span class="status">Optional</span>'}</div>
      ${a.connected ? `<div class="row"><span>Signed in as <b>${esc(a.user?.name)}</b></span><button class="btn ghost" data-action="asana-disconnect">Disconnect</button></div>
        <label class="lbl">Workspace<select class="field" id="a-ws">${a.workspaces.map((w) => `<option value="${esc(w.gid)}" ${w.gid === a.workspaceGid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>` : `
      <details class="help" ${S.fromSettings ? '' : 'open'}><summary>Step by step: get an Asana token (1 minute)</summary><ol class="steps">
        <li>Open <a href="#" data-action="open-link" data-url="https://app.asana.com/0/my-apps">Asana developer console</a>. (In Asana: your profile photo → <b>My settings</b> → <b>Apps</b> → <b>Manage developer apps</b>.)</li>
        <li>Under <b>Personal access tokens</b>, click <b>+ Create new token</b>, name it <i>Workmate Desk</i>, tick the agreement and click <b>Create token</b>.</li>
        <li>Click <b>Copy</b>. Asana shows the token only once; if you lose it, just make another.</li>
        <li>Paste it below, click <b>Connect Asana</b>, then pick your workspace.</li>
        </ol><p class="hint">The token acts as you: comments and changes you make here appear in Asana under your name.</p></details>
      <label class="lbl">Personal access token<input class="field" id="a-pat" type="password" placeholder="2/1234…" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="asana-connect">Connect Asana</button></div>`}
    </div>

    ${jiraCard()}
    ${salesforceCard()}

    <div class="card glass">
      <div class="card-head"><span class="badge ai">${I.spark}</span><div><h2>AI assistant</h2><p>Reads each email and advises which task or issue it belongs to and how urgent it is</p></div>
        ${ai.connected ? '<span class="status ok">Connected</span>' : '<span class="status">Optional</span>'}</div>
      ${ai.connected ? `<div class="row"><span>${{ 'claude-code': `Using your Claude Code on this PC${ai.version ? ' (' + esc(ai.version) + ')' : ''}`, platform: 'Signed in with your Claude Platform account' }[ai.mode] || 'Claude API key saved'}</span><button class="btn ghost" data-action="ai-disconnect">${ai.mode === 'key' ? 'Remove' : 'Stop using'}</button></div>
      ${ai.mode === 'claude-code' ? '<p class="hint">Uses the account Claude Code is signed in with, and counts toward its usage. Tools are switched off and your Claude Code settings, hooks and plugins are skipped, so an email can only be read, never acted on.</p>' : ''}` : `
      <p class="hint">Email text goes to Claude only for emails you open, plus up to 8 new unread ones per refresh.</p>
      <details class="help" ${S.fromSettings ? '' : 'open'}><summary>Step by step: use Claude Code (2 minutes)</summary><ol class="steps">
        <li>Already use Claude Code in a terminal? Click <b>Use Claude Code</b> below. That's all.</li>
        <li>If not, open <b>PowerShell</b> and run <code>irm https://claude.ai/install.ps1 | iex</code> (the official installer from the <a href="#" data-action="open-link" data-url="https://code.claude.com/docs">Claude Code docs</a>). Then open a new PowerShell window, type <code>claude</code> and sign in once. The Claude desktop app alone isn't enough: Workmate Desk needs this command-line version.</li>
        <li>Come back and click <b>Use Claude Code</b>. Workmate Desk finds it automatically, even if you have more than one install.</li>
        </ol></details>
      <div class="row"><span><b>Use Claude Code on this PC</b><br><span class="muted">Reuses the Claude Code you already use in the terminal, with the same sign-in. No key needed.</span></span><button class="btn primary" data-action="ai-claudecode">Use Claude Code</button></div>
      ${S.ccMissing ? '<div class="ctx glass-inner"><b>Claude Code not found</b><p class="muted">Install Claude Code and sign in once in a terminal (run <code>claude</code>), then click <i>Use Claude Code</i> again.</p></div>' : ''}
      <details class="help"><summary>Other ways to connect</summary>
        <div class="row"><span class="muted">Claude Platform account (pay-as-you-go API), sign in through the browser.</span><button class="btn ghost" data-action="ai-platform">Sign in with Claude Platform</button></div>
        ${S.antMissing ? `<div class="ctx glass-inner"><b>One-time setup: install the ant CLI</b>
          <ol class="steps"><li>Download the Windows build from <a href="#" data-action="open-link" data-url="https://github.com/anthropics/anthropic-cli/releases">anthropics/anthropic-cli releases</a>.</li>
          <li>Put <code>ant.exe</code> in a folder on your PATH.</li><li>Click <i>Sign in with Claude Platform</i> again.</li></ol></div>` : ''}
        <label class="lbl">Or an API key from the <a href="#" data-action="open-link" data-url="https://console.anthropic.com/settings/keys">Claude Console</a><input class="field" id="ai-key" type="password" placeholder="sk-ant-…" spellcheck="false"></label>
        <div class="row end"><button class="btn ghost" data-action="ai-connect">Save key</button></div></details>`}
    </div>

    <div class="card glass">
      <div class="card-head"><span class="badge ai">${I.spark}</span><div><h2>Claude Code connection</h2><p>Let Claude Code search and use your mail, tasks, calendar and timers</p></div>
        ${S.cfg.mcp?.enabled ? `<span class="status ${S.cfg.mcp.running ? 'ok' : ''}">${S.cfg.mcp.running ? 'Connected' : 'Starting…'}</span>` : '<span class="status">Optional</span>'}</div>
      ${S.cfg.mcp?.enabled ? `<div class="row"><span>Claude Code can use Workmate Desk${S.cfg.mcp.port ? ` (local port ${S.cfg.mcp.port})` : ''}. New Claude Code sessions pick it up; restart open ones.</span><button class="btn ghost" data-action="mcp-disable">Disconnect</button></div>` : `
      <p class="hint">Adds Workmate Desk as a tool in every Claude Code session on this PC, in the terminal or the desktop app. Then ask things like <i>"what's on my plate today?"</i>, <i>"what's the latest on the Dynalite task?"</i> or <i>"link Priya's email to the budget task"</i>.</p>
      <details class="help" ${S.fromSettings ? '' : 'open'}><summary>What Claude Code can do</summary><ol class="steps">
        <li><b>Read:</b> your day at a glance, search tasks and email, read a task's full context or an email thread, your calendar.</li>
        <li><b>Act, only with your OK:</b> link an email to a task, comment on a task, start or stop an Everhour timer. Claude Code asks before each one.</li>
        <li>It stays on this PC: Claude Code talks to Workmate Desk locally with a private key, and Workmate Desk must be running.</li>
      </ol></details>
      <div class="row end"><button class="btn primary" data-action="mcp-enable">Connect to Claude Code</button></div>`}
    </div>

    <div class="card glass">
      <div class="card-head"><span class="badge eh">${I.play}</span><div><h2>Everhour</h2><p>Start and stop timers on your Asana tasks</p></div>
        ${S.cfg.everhour?.connected ? '<span class="status ok">Connected</span>' : '<span class="status">Optional</span>'}</div>
      ${S.cfg.everhour?.connected ? `<div class="row"><span>Signed in as <b>${esc(S.cfg.everhour.user?.name)}</b></span><button class="btn ghost" data-action="everhour-disconnect">Disconnect</button></div>` : `
      <details class="help" ${S.fromSettings ? '' : 'open'}><summary>Step by step: connect Everhour (1 minute)</summary><ol class="steps">
        <li>Open your <a href="#" data-action="open-link" data-url="https://app.everhour.com/#/account/profile">Everhour profile</a> (in Everhour: your avatar → <b>My profile</b>).</li>
        <li>Scroll to the bottom to <b>API key</b> and copy it.</li>
        <li>Paste it below and click <b>Connect Everhour</b>.</li>
        <li>Timers only work on tasks whose Asana project is connected in Everhour. If a task says it isn't in Everhour yet, add its project under <b>Projects</b> in Everhour.</li>
        </ol></details>
      <label class="lbl">API key<input class="field" id="eh-key" type="password" spellcheck="false"></label>
      <div class="row end"><button class="btn primary" data-action="everhour-connect">Connect Everhour</button></div>`}
    </div>

    ${S.fromSettings ? appearanceCard() : ''}
    ${S.fromSettings ? `<div class="card glass">
      <div class="card-head"><span class="badge g">✉</span><div><h2>Mail</h2><p>How much to load, and which senders to keep out of the inbox</p></div></div>
      <div class="row">
        <label class="lbl inline">From the last<select class="field" id="mail-days">${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days'], [365, 'year'], [0, 'all time']].map(([v, l]) => `<option value="${v}" ${S.mailDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="lbl inline">Load up to<select class="field" id="mail-max">${[50, 100, 200, 500].map((v) => `<option value="${v}" ${S.mailMax === v ? 'selected' : ''}>${v} emails</option>`).join('')}</select></label>
      </div>
      <p class="hint">"Load more" at the bottom of the inbox always fetches older mail on top of this.</p>
      <div class="sub">Muted senders</div>
      <p class="hint" style="margin-top:0">Mail from these goes into one "Muted" row instead of your inbox. Use a full address or a whole domain.</p>
      <div class="chips mute-list">${S.muted.map((p) => `<span class="chip gray">${esc(p)}<button class="chip-x" data-action="filter-remove" data-p="${esc(p)}" title="Unmute">×</button></span>`).join('') || '<span class="muted">Nothing muted</span>'}</div>
      <div class="row"><input class="field" id="mute-add" placeholder="everhour.com or name@company.com" spellcheck="false"><button class="btn ghost" data-action="filter-add">Mute</button></div>
    </div>
    <div class="card glass">
      <label class="lbl inline" style="margin-bottom:14px">When I close the window<select class="field" id="close-action">${[['ask', 'Ask me'], ['widget', 'Turn into widget'], ['quit', 'Quit Workmate Desk']].map(([v, l]) => `<option value="${v}" ${S.ui.closeAction === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="login" ${S.ui.openAtLogin ? 'checked' : ''}><span></span>Open at Windows sign-in</label>
      <label class="toggle" style="margin-top:12px"><input type="checkbox" id="notify" ${store.get('notify') === false ? '' : 'checked'}><span></span>Notify me about new tasks, Jira issues and urgent email</label>
    </div>` : ''}

    <div class="row center"><button class="btn primary big" data-action="setup-done" ${S.cfg.accounts.length ? '' : 'disabled'}>${S.fromSettings ? 'Done' : 'Continue'}</button></div>
  </section>`;
}

// ---------- mail ----------
function mailSkeleton() {
  return `<section class="mail">
    <div class="pane glass list-pane">
      <div class="pane-head">
        <div class="ph-row"><h2>Inbox</h2><span class="muted" id="mail-count"></span></div>
        <input class="field search" id="q" type="search" placeholder="Search" value="${esc(S.q)}">
        ${S.cfg.accounts.length > 1 ? `<select class="field acct-pick" id="acct-filter"><option value="">All accounts</option>${S.cfg.accounts.map((a) => `<option value="${esc(a.id)}" ${S.acctFilter === a.id ? 'selected' : ''}>${providerName(a.provider)} · ${esc(a.email)}</option>`).join('')}</select>` : ''}
        <div class="seg small" id="mail-filter"></div>
      </div>
      <div class="scroll" id="mail-list"></div>
      ${resizer('w-list', 'right')}
    </div>
    <div class="pane glass detail-pane"><div class="scroll"><div id="detail-head"></div><div id="detail-body"></div></div></div>
    <aside class="pane glass focus-pane">
      <div class="pane-head"><div class="ph-row"><h2>Focus</h2><span class="muted">Tasks</span></div></div>
      <div class="scroll" id="focus"></div>
      ${resizer('w-focus', 'left')}
    </aside>
  </section>`;
}

// noise: Asana/Everhour notifications, plus any sender you muted; collapsed into one row
// a muted entry is a full address (ann@acme.com) or a domain (everhour.com, also matches its subdomains)
const mutes = (addr, p) => (p.includes('@') ? addr === p : addr.endsWith('@' + p) || addr.endsWith('.' + p));
const isNoise = (m) => S.muted.some((p) => mutes(m.fromAddr, p));
function mutedSources(list) {
  const names = [...new Set(list.map((m) => /asana\.com/i.test(m.fromAddr) ? 'Asana' : /everhour\.com/i.test(m.fromAddr) ? 'Everhour' : m.fromName))];
  return names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
}

// Same sender + same subject (ignoring Re:/Fwd:) = one row. Gmail sometimes files the same email,
// e.g. a calendar update sent twice, as separate threads; opening the row marks all of them read.
const dupKey = (m) => `${m.fromAddr}|${m.subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '').trim().toLowerCase()}`;
const groupOf = (m) => S.groupMap?.get(dupKey(m)) || [m];
const groupUnread = (m) => groupOf(m).some((x) => x.labelIds.includes('UNREAD'));
function regroup() {
  S.groupMap = new Map();
  for (const m of S.emails) { const k = dupKey(m); if (!S.groupMap.has(k)) S.groupMap.set(k, []); S.groupMap.get(k).push(m); }
}
const heads = (list) => { const seen = new Set(); return list.filter((m) => { const k = dupKey(m); return !seen.has(k) && seen.add(k); }); }; // newest of each group

const inScope = () => (S.acctFilter ? S.emails.filter((m) => m.acct === S.acctFilter) : S.emails);
function visibleEmails() {
  regroup();
  const q = S.q.toLowerCase();
  let list = heads(inScope()).filter((m) => !q || groupOf(m).some((x) => (x.subject + x.from + x.snippet).toLowerCase().includes(q)));
  const asana = list.filter(isNoise);
  if (S.filter === 'asana') return { list: asana, asana };
  list = list.filter((m) => !isNoise(m));
  if (S.filter === 'urgent') list = list.filter((m) => m.u.level !== 'normal').sort((a, b) => b.u.score - a.u.score);
  // strictly unread and not muted (an email you open leaves this list; the reading pane keeps showing it)
  if (S.filter === 'unread') list = list.filter(groupUnread);
  return { list, asana };
}

function mailItem(m) {
  const linked = (S.links[m.key] || []).length;
  const ai = S.ai[aiKey(m)];
  const n = groupOf(m).length;
  return `<button class="mail-item lv-${m.u.level} ${S.sel === m.key ? 'sel' : ''} ${groupUnread(m) ? 'unread' : ''}" data-action="open-mail" data-id="${esc(m.key)}" ${n > 1 ? `title="${n} copies of this email, shown once"` : ''}>
    <span class="avatar" style="--h:${hue(m.fromAddr)}">${esc(initials(m.fromName))}</span>
    <span class="mi">
      <span class="mi-top"><span class="mi-from">${esc(m.fromName)}</span><span class="mi-time">${fmtShort(m.date)}</span></span>
      <span class="mi-subj">${esc(m.subject)}</span>
      <span class="mi-snip">${esc(ai?.summary || m.snippet)}</span>
      ${S.cfg.accounts.length > 1 ? `<span class="mi-src"><span class="src ${m.provider}">${providerName(m.provider)}</span>${esc(m.mailbox)}</span>` : ''}
      <span class="chips">
        ${n > 1 ? `<span class="chip gray">×${n}</span>` : ''}
        ${m.u.level === 'urgent' ? '<span class="chip red">Urgent</span>' : m.u.level === 'high' ? '<span class="chip orange">High</span>' : ''}
        ${linked ? `<span class="chip blue">${I.link}${linked}</span>` : ''}
        ${ai?.suggestions?.length && !linked ? `<span class="chip purple">${I.spark}Task match</span>` : ''}
        ${S.aiPending.has(aiKey(m)) ? '<span class="chip gray shimmer">Reading…</span>' : ''}
      </span>
    </span>
  </button>`;
}

function renderList() {
  const { list, asana } = visibleEmails();
  const rows = heads(inScope()).filter((m) => !isNoise(m));
  const urgentCount = rows.filter((m) => m.u?.level !== 'normal').length;
  const unreadCount = rows.filter(groupUnread).length;
  $('#mail-filter').innerHTML = [['all', 'All'], ['unread', `Unread${unreadCount ? ' ' + unreadCount : ''}`], ['urgent', `Urgent${urgentCount ? ' ' + urgentCount : ''}`], ['asana', `Muted${asana.length ? ' ' + asana.length : ''}`]]
    .map(([f, l]) => `<button class="${S.filter === f ? 'on' : ''}" data-action="filter" data-f="${f}">${l}</button>`).join('');
  $('#mail-count').textContent = `${list.length}`;
  const digest = S.filter === 'all' && asana.length ? `<button class="digest" data-action="filter" data-f="asana">
      <span class="badge a sm">a</span><span><b>${asana.length} notifications muted</b><br><span class="muted">${esc(mutedSources(asana))}</span></span>${I.fwd}</button>` : '';
  $('#mail-list').innerHTML = S.loading && !S.emails.length ? '<div class="empty">Loading mail…</div>'
    : digest + (list.map(mailItem).join('') || '<div class="empty">Nothing here</div>')
      + (Object.values(S.mailNext).some((v) => v !== null) ? '<button class="noise-toggle" data-action="load-more">Load 50 more</button>' : `<p class="muted center">That's everything${S.mailDays ? ` from the last ${S.mailDays} days` : ''}</p>`);
}

const selectedEmail = () => S.emails.find((m) => m.key === S.sel);

function taskRow(t, extra = '') {
  return `<div class="task-row">
    <span class="tdot ${dueClass(t)}"></span>
    <span class="tr-main"><a href="#" data-action="goto-task" data-gid="${esc(t.gid)}">${esc(t.name)}</a>
      <span class="muted">${dueLabel(t)}${t.projects?.[0] ? ' · ' + esc(t.projects[0].name) : ''}</span></span>
    ${extra}</div>`;
}

// every typed word must appear in the task name or its project names (any order, any case)
function matchesQuery(t, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${t.name} ${(t.projects || []).map((p) => p.name).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function linkResults() {
  const m = selectedEmail();
  if (!m || !S.linkQ.trim()) return '';
  const linked = new Set(S.links[m.key] || []);
  const hits = allTasks().filter((t) => !linked.has(t.gid) && matchesQuery(t, S.linkQ));
  return hits.slice(0, 8).map((t) => taskRow(t, `<button class="btn tiny" data-action="link" data-gid="${esc(t.gid)}">Link</button>`)).join('')
    + (hits.length > 8 ? `<p class="muted">${hits.length - 8} more, keep typing to narrow down</p>` : '')
    + (hits.length ? '' : '<p class="muted">No matching task</p>');
}

// Auto | Urgent | High | Normal; autoLevel shows what Auto would pick when a manual choice hides it
function urgencyPicker(kind, key, label, autoLevel) {
  const cur = S.urg[kind][key] || '';
  const opts = [['', autoLevel ? `Auto (${autoLevel})` : 'Auto'], ['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal']];
  return `<div class="urg"><span class="muted">${esc(label)}</span><div class="seg mini">${opts.map(([v, l]) =>
    `<button class="${cur === v ? 'on' : ''} ${v ? 'lv-' + v : ''}" data-action="set-urg" data-kind="${kind}" data-key="${esc(key)}" data-level="${v}">${esc(l)}</button>`).join('')}</div></div>`;
}

// redraw the email header in place: same email keeps the pane's scroll position
// keep the focused field (e.g. the "link a task" search), its caret and the pane's scroll through a redraw
function keepFocus(container, redraw) {
  const act = document.activeElement;
  const id = act && container?.contains(act) ? act.id : '';
  const sel = id && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
  redraw();
  const f = id && document.getElementById(id);
  if (f) { f.focus({ preventScroll: true }); if (sel) try { f.setSelectionRange(sel[0], sel[1]); } catch {} }
}

function renderDetailHead() {
  const pane = $('.detail-pane .scroll');
  const y = pane && pane.dataset.for === (S.sel || '') ? pane.scrollTop : 0;
  keepFocus($('#detail-head'), renderDetailHeadNow);
  if (pane) { pane.dataset.for = S.sel || ''; pane.scrollTop = y; }
}

function renderDetailHeadNow() {
  const m = selectedEmail();
  const el = $('#detail-head');
  if (!el) return;
  if (!m) { el.innerHTML = '<div class="empty big">Select an email<br><span class="muted">Urgent mail is marked red. Linked tasks and Jira issues show up here.</span></div>'; return; }
  const linked = linkedTasks(m);
  const linkedSet = new Set(linked.map((t) => t.gid));
  const k = aiKey(m), ai = S.ai[k];
  const unlinkedTasks = allTasks().filter((t) => !linkedSet.has(t.gid));

  // Foldable sections: Urgency, AI context, Linked tasks. Folded, each keeps a one-line summary.
  // What you fold is remembered (Urgency starts folded: it's set rarely).
  const fold = (name, cls, head, hint, body, dflt) => `<details class="ctx glass-inner fold ${cls}" data-fold="${name}" ${(store.get('fold:' + name) ?? dflt) ? 'open' : ''}>
      <summary class="ctx-head">${I.chev}${head}${hint ? `<span class="fold-hint">${hint}</span>` : ''}</summary>${body ? `<div class="fold-body">${body}</div>` : ''}</details>`;
  const urgClass = { urgent: 'red', high: 'orange', normal: 'gray', low: 'gray' };
  const cap = (x) => x[0].toUpperCase() + x.slice(1);

  let aiCard;
  if (!S.cfg.ai.connected) {
    const local = Urgency.matchTasks(m, allTasks()).filter((t) => !linkedSet.has(t.gid));
    aiCard = fold('ai', '', `${I.spark}<b>Suggestions</b>`, local.length ? `${local.length} possible task${local.length > 1 ? 's' : ''}` : 'No obvious matching task',
      `<p class="muted">Keyword match. Add an AI assistant in Settings for better advice.</p>${local.map((t) => taskRow(t, `<button class="btn tiny" data-action="link" data-gid="${t.gid}">Link</button>`)).join('')}`, true);
  } else if (S.aiPending.has(k)) {
    aiCard = fold('ai', 'ai', `${I.spark}<b>AI context</b>`, 'Reading…', '<div class="shimmer-lines"><i></i><i></i><i></i></div>', true);
  } else if (S.aiErr[k]) {
    aiCard = fold('ai', 'ai', `${I.spark}<b>AI context</b><button class="btn tiny" data-action="reanalyze">Retry</button>`, esc(S.aiErr[k]), `<p class="muted">${esc(S.aiErr[k])}</p>`, true);
  } else if (ai) {
    const sugg = ai.suggestions.filter((s) => !linkedSet.has(s.task_gid));
    aiCard = fold('ai', 'ai', `${I.spark}<b>AI context</b><span class="chip ${urgClass[ai.urgency]}">${esc(cap(ai.urgency))}</span><button class="btn tiny ghost" data-action="reanalyze" title="Analyse again">${I.refresh}</button>`,
      esc(ai.summary),
      `<p class="summary">${esc(ai.summary)}</p>
      <p class="muted">${esc(ai.urgency_reason)}${ai.action_needed && ai.action_needed !== 'None' ? ` · <b>Next:</b> ${esc(ai.action_needed)}` : ''}</p>
      ${sugg.length ? `<div class="sub">Might belong to</div>${sugg.map((s) => { const t = taskById(s.task_gid); return t ? taskRow(t, `<span class="conf ${s.confidence}" title="${esc(s.reason)}">${s.confidence}</span><button class="btn tiny" data-action="link" data-gid="${t.gid}">Link</button>`) + `<p class="reason">${esc(s.reason)}</p>` : ''; }).join('')}`
        : '<p class="muted">No existing task looks related.</p>'}
      ${ai.new_task?.suggested && S.cfg.asana.connected ? `<div class="row"><span class="muted">No task yet: “${esc(ai.new_task.name)}”</span><button class="btn tiny" data-action="create-task" data-name="${esc(ai.new_task.name)}">Create task</button></div>` : ''}`, true);
  } else {
    aiCard = fold('ai', 'ai', `${I.spark}<b>AI context</b><button class="btn tiny" data-action="reanalyze">Analyse</button>`, 'Not read yet', '', true);
  }

  const urgCard = fold('urg', 'urg', `${I.flag}<b>Urgency</b><span class="chip ${urgClass[m.u.level] || 'gray'}">${esc(cap(m.u.level))}</span>`,
    esc(m.u.reasons.join(' · ') || 'Automatic'),
    `<div class="chips">${m.u.reasons.map((r) => `<span class="chip ${m.u.level === 'urgent' ? 'red' : m.u.level === 'high' ? 'orange' : 'gray'}">${esc(r)}</span>`).join('')}</div>
      ${urgencyPicker('threads', m.key, 'This email', m.u.manual === 'thread' ? m.u.auto?.level : null)}
      ${urgencyPicker('senders', m.fromAddr, `All mail from ${m.fromName}`)}`, false);

  const linkCard = fold('link', 'links', `${I.link}<b>Linked tasks</b><span class="count-pill">${linked.length}</span>`,
    esc(linked.map((t) => t.name).join(' · ') || 'None yet'),
    `${linked.map((t) => taskRow(t, `<button class="btn tiny ghost" data-action="unlink" data-gid="${t.gid}">Unlink</button>`)).join('') || '<p class="muted">None yet. Saved on this PC.</p>'}
      ${unlinkedTasks.length ? `<input class="field search" id="link-q" type="search" placeholder="Search your ${unlinkedTasks.length} tasks and issues to link…" value="${esc(S.linkQ)}" style="margin-top:10px">
        <div class="search-results" id="link-results">${linkResults()}</div>` : ''}`, true);

  const acct = acctOf(m.acct);
  const reconnect = acct && (!acct.canModify || acct.needsReconnect) ? `<div class="ctx glass-inner"><div class="row" style="margin:0"><span>${acct.needsReconnect ? `Sign-in for ${esc(acct.email)} expired.` : 'Reconnect Google once so opening an email marks it read in Gmail.'}</span>
      <button class="btn tiny primary" data-action="acct-reconnect" data-id="${esc(acct.id)}">Reconnect</button></div></div>` : '';
  el.innerHTML = `${reconnect}<div class="d-head">
      <h1>${esc(m.subject)}</h1>
      <div class="d-from"><span class="avatar" style="--h:${hue(m.fromAddr)}">${esc(initials(m.fromName))}</span>
        <span><b>${esc(m.fromName)}</b> <span class="muted">${esc(m.fromAddr)}</span><br><span class="muted">${m.date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · to <span class="src ${m.provider}">${providerName(m.provider)}</span> ${esc(m.mailbox)}</span></span></div>
      <div class="row"><button class="btn ghost" data-action="open-link" data-url="${esc(m.webUrl)}">${I.ext}Open in ${providerName(m.provider)}</button>
        <button class="btn ghost" data-action="mute" data-addr="${esc(m.fromAddr)}">${isNoise(m) ? 'Unmute sender' : 'Mute sender'}</button>
        ${S.cfg.asana.connected ? '<button class="btn ghost" data-action="create-task">Create Asana task</button>' : ''}
        ${S.cfg.salesforce.connected ? '<button class="btn ghost" data-action="case-from-mail">Create Salesforce case</button>' : ''}</div>
    </div>
    ${urgCard}
    ${aiCard}
    ${tasksOn() ? linkCard : ''}`;
}

async function renderDetailBody() {
  const m = selectedEmail();
  const el = $('#detail-body');
  if (!el) return;
  S.bodyFor = S.sel;
  if (!m) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="paper loading">Loading…</div>';
  try {
    const b = await loadBody(m);
    if (S.sel !== m.key) return;
    const frame = document.createElement('iframe');
    frame.className = 'paper';
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox'); // no scripts, no same-origin
    frame.srcdoc = threadDoc(b);
    el.replaceChildren(frame);
  } catch (e) { el.innerHTML = `<div class="paper loading">${esc(clean(e))}</div>`; }
}

function renderFocus() {
  const el = $('#focus');
  if (!el) return;
  if (!tasksOn()) { el.innerHTML = '<div class="empty">Connect Asana or Jira in Settings to see tasks here.</div>'; return; }
  const linked = signalGids();
  const now = new Date();
  const rated = allTasks().map((t) => ({ t, s: Urgency.taskSignal(t, linked, now) }));
  const sig = rated.filter((x) => x.s.signal).sort((a, b) => a.s.rank - b.s.rank);
  const noise = rated.filter((x) => !x.s.signal);
  const row = ({ t, s }) => `<a href="#" class="focus-item" data-action="goto-task" data-gid="${esc(t.gid)}">
      <span class="tdot ${dueClass(t)}"></span><span><span class="fi-name">${esc(t.name)}</span><span class="muted">${esc(s.why)}${t.projects?.[0] ? ' · ' + esc(t.projects[0].name) : ''}</span></span></a>`;
  el.innerHTML = (sig.map(row).join('') || '<div class="empty">All clear</div>')
    + (noise.length ? `<button class="noise-toggle" data-action="noise">${S.showNoise ? 'Hide' : 'Show'} ${noise.length} quiet tasks</button>` : '')
    + (S.showNoise ? `<div class="noise">${noise.map(row).join('')}</div>` : '');
}

// ---------- calendar (Google events + Asana due dates in one grid) ----------
function calGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - lead + i));
}

function itemsByDay() {
  const map = new Map();
  const add = (k, it) => { if (!map.has(k)) map.set(k, []); map.get(k).push(it); };
  for (const e of S.events) {
    if (!S.showRoutine && e.recurringEventId) continue; // routine = instance of a recurring series
    if (!S.showHidden && isHiddenEv(e)) continue; // hidden by you in Workmate Desk only
    const allDay = !!e.start.date;
    if (allDay) for (let d = evStart(e); d < evEnd(e); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) add(key(d), { kind: 'event', id: e.id, e, allDay, sort: -1 });
    else add(key(evStart(e)), { kind: 'event', id: e.id, e, allDay, sort: +evStart(e) });
  }
  for (const t of allTasks()) { const d = Urgency.dueDate(t); if (d) add(key(d), { kind: 'task', id: t.gid, t, sort: t.due_at ? +d : Infinity }); }
  map.forEach((v) => v.sort((a, b) => a.sort - b.sort));
  return map;
}

// events hidden in Workmate Desk (by single event or whole recurring series); Google Calendar is never changed
const isHiddenEv = (e) => S.hiddenEv.ids.includes(e.id) || (!!e.recurringEventId && S.hiddenEv.series.includes(e.recurringEventId));
function setHidden(patch, msg) {
  S.hiddenEv = { ...S.hiddenEv, ...patch };
  store.set('hiddenEvents', S.hiddenEv);
  if (!S.showHidden) S.calItem = null;
  renderCalendar(); toast(msg);
}
const declined = (e) => e.attendees?.some((a) => a.self && a.responseStatus === 'declined');
function chip(it) {
  if (it.kind === 'event') return `<div class="cchip ev ${declined(it.e) ? 'declined' : ''} ${isHiddenEv(it.e) ? 'hidden-ev' : ''}" data-action="cal-item" data-kind="event" data-id="${esc(it.id)}">${it.allDay ? '' : `<span>${fmtTime(evStart(it.e))}</span>`}${esc(it.e.summary || '(busy)')}</div>`;
  return `<div class="cchip task ${dueClass(it.t)}" data-action="cal-item" data-kind="task" data-id="${esc(it.id)}">◆ ${esc(it.t.name)}</div>`;
}

function renderCalendar() {
  const grid = calGrid(S.calMonth);
  const byDay = itemsByDay();
  const routineCount = S.events.filter((e) => e.recurringEventId).length;
  const hiddenCount = S.events.filter(isHiddenEv).length;
  const today = new Date();
  const selKey = S.calDay || key(today);
  const cells = grid.map((d) => {
    const k = key(d), items = byDay.get(k) || [];
    return `<div class="cell ${d.getMonth() !== S.calMonth.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''} ${k === selKey ? 'sel' : ''}" data-action="cal-day" data-day="${k}">
      <span class="num">${d.getDate()}</span>
      <div class="cell-items">${items.slice(0, 3).map(chip).join('')}${items.length > 3 ? `<div class="more">+${items.length - 3} more</div>` : ''}</div></div>`;
  }).join('');

  const [y, mo, da] = selKey.split('-').map(Number);
  const selDate = new Date(y, mo - 1, da);
  const dayItems = byDay.get(selKey) || [];
  const undated = allTasks().filter((t) => !Urgency.dueDate(t)).length;
  $('#app').innerHTML = `<section class="cal">
    <div class="pane glass cal-main">
      <div class="cal-head">
        <h2><b>${S.calMonth.toLocaleDateString([], { month: 'long' })}</b> ${S.calMonth.getFullYear()}</h2>
        <div class="legend"><span class="ldot ev"></span>Calendar<span class="ldot task"></span>Task due</div>
        ${routineCount ? `<button class="btn tiny ${S.showRoutine ? 'ghost' : 'primary'}" data-action="routine" title="Recurring events such as standups and 1:1s">${S.showRoutine ? 'Hide routine' : `Show routine (${routineCount})`}</button>` : ''}
        ${hiddenCount ? `<button class="btn tiny ${S.showHidden ? 'primary' : 'ghost'}" data-action="show-hidden" title="Events you hid in Workmate Desk">${I.eye}Hidden (${hiddenCount})</button>` : ''}
        <div class="cal-nav"><button class="icon" data-action="cal-prev">${I.back}</button><button class="btn ghost tiny" data-action="cal-today">Today</button><button class="icon" data-action="cal-next">${I.fwd}</button></div>
      </div>
      <div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>
    <aside class="pane glass cal-side"><div class="scroll">
      <h2 class="side-date">${selDate.toLocaleDateString([], { weekday: 'long' })}<br><span class="muted">${selDate.toLocaleDateString([], { day: 'numeric', month: 'long' })}</span></h2>
      ${dayItems.map(dayItem).join('') || '<div class="empty">Nothing scheduled</div>'}
      ${undated ? `<button class="noise-toggle" data-action="tab" data-tab="tasks">${undated} open ${undated === 1 ? 'task has' : 'tasks have'} no due date</button>` : ''}
    </div>${resizer('w-cal', 'left')}</aside>
  </section>`;
}

function dayItem(it) {
  const open = S.calItem?.kind === it.kind && S.calItem?.id === it.id;
  if (it.kind === 'event') {
    const e = it.e;
    const time = it.allDay ? 'All day' : `${fmtTime(evStart(e))} – ${fmtTime(evEnd(e))}`;
    let detail = '';
    if (open) {
      const att = (e.attendees || []).filter((a) => !a.self);
      const addrs = new Set(att.map((a) => a.email.toLowerCase()));
      const mails = S.emails.filter((m) => addrs.has(m.fromAddr)).slice(0, 5);
      const tasks = Urgency.matchTasks({ subject: e.summary || '', snippet: '' }, allTasks());
      detail = `<div class="di-detail">
        ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
        <div class="row">${e.hangoutLink ? `<button class="btn tiny" data-action="open-link" data-url="${esc(e.hangoutLink)}">Join Meet</button>` : ''}
          <button class="btn tiny ghost" data-action="open-link" data-url="${esc(e.htmlLink)}">${I.ext}Google Calendar</button></div>
        <div class="row">${isHiddenEv(e) ? `<button class="btn tiny ghost" data-action="unhide-ev" data-id="${esc(e.id)}" data-series="${esc(e.recurringEventId || '')}">Unhide</button>`
          : `<button class="btn tiny ghost" data-action="hide-ev" data-id="${esc(e.id)}">Hide this event</button>${e.recurringEventId ? `<button class="btn tiny ghost" data-action="hide-series" data-series="${esc(e.recurringEventId)}">Hide whole series</button>` : ''}`}
          <span class="muted hint-sm">Only in Workmate Desk. Your Google Calendar is not changed.</span></div>
        ${att.length ? `<div class="sub">${att.length} guests</div><p class="muted">${att.slice(0, 8).map((a) => esc(a.displayName || a.email)).join(', ')}${att.length > 8 ? '…' : ''}</p>` : ''}
        ${e.description ? `<p class="desc">${esc(htmlToText(e.description).slice(0, 600))}</p>` : ''}
        ${mails.length ? `<div class="sub">Recent mail from guests</div>${mails.map((m) => `<a href="#" class="mini-mail" data-action="goto-mail" data-id="${esc(m.key)}"><b>${esc(m.fromName)}</b> ${esc(m.subject)}</a>`).join('')}` : ''}
        ${tasks.length ? `<div class="sub">Related tasks</div>${tasks.map((t) => taskRow(t)).join('')}` : ''}
      </div>`;
    }
    return `<div class="day-item ev ${open ? 'open' : ''} ${declined(e) ? 'declined' : ''} ${isHiddenEv(e) ? 'hidden-ev' : ''}" data-action="cal-item" data-kind="event" data-id="${esc(it.id)}">
      <span class="bar"></span><div><div class="di-time">${time}</div><div class="di-title">${esc(e.summary || '(busy)')}</div>${detail}</div></div>`;
  }
  const t = it.t;
  let detail = '';
  if (open) {
    const mails = threadsForTask(t.gid);
    detail = `<div class="di-detail">
      ${t.projects?.length ? `<p class="muted">${t.projects.map((p) => esc(p.name)).join(', ')}</p>` : ''}
      ${t.notes ? `<p class="desc">${esc(t.notes.slice(0, 500))}</p>` : ''}
      <div class="row"><button class="btn tiny" data-action="goto-task" data-gid="${esc(t.gid)}">Open task</button><button class="btn tiny ghost" data-action="open-link" data-url="${esc(t.permalink_url)}">${I.ext}${isJira(t.gid) ? 'Jira' : 'Asana'}</button></div>
      ${mails.length ? `<div class="sub">Related mail</div>${mails.map((m) => `<a href="#" class="mini-mail" data-action="goto-mail" data-id="${esc(m.key)}"><b>${esc(m.fromName)}</b> ${esc(m.subject)}</a>`).join('')}` : ''}
    </div>`;
  }
  return `<div class="day-item task ${dueClass(t)} ${open ? 'open' : ''}" data-action="cal-item" data-kind="task" data-id="${esc(it.id)}">
    <span class="bar"></span><div><div class="di-time">${t.due_at ? fmtTime(new Date(t.due_at)) : 'Due'} · ${isJira(t.gid) ? 'Jira' : 'Asana'}</div><div class="di-title">${esc(t.name)}</div>${detail}</div></div>`;
}

// ---------- tasks (Asana boards as set up, plus task detail with comments) ----------
const threadsForTask = (gid) => S.emails.filter((m) => (S.links[m.key] || []).includes(gid) || relatedTasks(m).some((t) => t.gid === gid));

function taskCard(t) {
  const mails = threadsForTask(t.gid).length;
  const due = Urgency.dueDate(t);
  const other = t.blocksMe || t.waitsOnMe; // someone else's task: opens in Asana on the web
  const blockedBy = openDeps(t.dependencies).length, blocking = openDeps(t.dependents).length;
  const act = other ? `data-action="open-link" data-url="${esc(taskUrl(t))}"` : `data-action="open-task" data-gid="${esc(t.gid)}"`;
  return `<button class="tcard ${other ? 'other' : ''} ${S.taskSel === t.gid ? 'sel' : ''}" ${act} ${other ? '' : `draggable="true" data-drag="${esc(t.gid)}"`} title="${esc(t.name)}${t.parent ? ' (subtask of ' + esc(t.parent.name) + ')' : ''}">
    <span class="tc-name">${esc(t.name)}${other ? ` ${I.ext}` : ''}</span>
    <span class="tc-meta">
      ${timerGid() === t.gid ? '<span class="chip green"><span class="rec"></span>Tracking</span>' : ''}
      ${statusChip(t)}
      ${t.parent ? '<span class="chip gray">Subtask</span>' : ''}
      ${t.blocksMe ? '<span class="chip red">Blocks you</span>' : t.waitsOnMe ? '<span class="chip orange">Waiting on you</span>' : ''}
      ${!other && blockedBy ? `<span class="chip red">Blocked by ${blockedBy}</span>` : ''}
      ${!other && blocking ? `<span class="chip purple">Blocking ${blocking}</span>` : ''}
      ${due ? `<span class="chip ${dueClass(t) === 'overdue' ? 'red' : dueClass(t) === 'soon' ? 'orange' : 'gray'}">${dueLabel(t)}</span>` : ''}
      ${mails ? `<span class="chip blue">${I.link}${mails}</span>` : ''}
      ${t.assignee && other ? `<span class="avatar xs" style="--h:${hue(t.assignee.name)}" title="${esc(t.assignee.name)}">${esc(initials(t.assignee.name))}</span>` : ''}
    </span></button>`;
}

function renderBoard() {
  const el = $('#board');
  if (!el) return;
  if (!tasksOn()) { el.innerHTML = '<div class="empty big">Connect Asana or Jira in Settings to see your boards.</div>'; return; }
  const loading = !['my', 'jira'].includes(S.boardSrc) && (!S.board || S.board.src !== S.boardSrc || S.board.loading);
  if (loading || (S.loading && !allTasks().length)) { el.innerHTML = '<div class="empty">Loading board…</div>'; return; }
  const q = S.taskQ.trim();
  const cols = (S.boardSrc === 'my' ? myColumns() : S.boardSrc === 'jira' ? jiraColumns() : S.board.columns)
    .map((c) => (q ? { ...c, tasks: c.tasks.filter((t) => matchesQuery(t, q)) } : c))
    .filter((c) => !q || c.tasks.length); // while searching, hide columns with no hits
  $('#board-count').textContent = `${cols.reduce((n, c) => n + c.tasks.length, 0)} ${q ? 'found' : 'open'}`;
  el.innerHTML = cols.map((c) => `<div class="col" ${c.gid !== 'none' ? `data-col="${esc(c.gid)}"` : ''}>
      <div class="col-head"><b>${esc(c.name)}</b><span class="muted">${c.tasks.length}</span></div>
      <div class="col-body">${c.tasks.map(taskCard).join('') || '<div class="col-empty">No open tasks</div>'}</div>
    </div>`).join('') || `<div class="empty">${q ? 'No matching tasks' : 'This board has no sections.'}</div>`;
}

// Board order of preference: the default you starred, else your busiest board; My Tasks only as the last resort
const homeBoard = () => S.defaultBoard || S.boards[0]?.gid || (S.cfg.asana.connected || !S.cfg.jira.connected ? 'my' : 'jira');
function boardForTask(gid) {
  if (isJira(gid)) return 'jira';
  const t = S.tasks.find((x) => x.gid === gid) || (S.board?.columns || []).flatMap((c) => c.tasks).find((x) => x.gid === gid);
  const on = new Set(t ? boardsOf(t).map((p) => p.gid) : []);
  if (on.has(homeBoard())) return homeBoard();
  if (S.boardSrc !== 'my' && on.has(S.boardSrc)) return S.boardSrc; // already looking at a board it's on
  return S.boards.find((b) => on.has(b.gid))?.gid || [...on][0] || 'my';
}
const allBoards = () => [...S.boards, ...(S.cfg.jira.connected ? [{ gid: 'jira', name: 'Jira: my issues', n: S.jira.length }] : []),
  ...(S.cfg.asana.connected ? [{ gid: 'my', name: 'My Tasks', n: S.tasks.length }] : [])]; // My Tasks is always the last choice
const boardName = (gid) => allBoards().find((b) => b.gid === gid)?.name || (gid === 'jira' ? 'Jira: my issues' : 'My Tasks');

function boardList() {
  const q = S.boardQ.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = allBoards().filter((b) => q.every((w) => b.name.toLowerCase().includes(w)));
  return rows.map((b) => `<div class="bm-row ${b.gid === S.boardSrc ? 'cur' : ''}" data-action="pick-board" data-gid="${esc(b.gid)}">
      <span class="bm-name">${esc(b.name)}</span><span class="muted">${b.n}</span>
      <button class="star ${b.gid === homeBoard() ? 'on' : ''}" data-action="default-board" data-gid="${esc(b.gid)}" title="${b.gid === homeBoard() ? 'Default board' : 'Make this my default board'}">${b.gid === S.defaultBoard ? '★' : '☆'}</button>
    </div>`).join('') || '<div class="col-empty">No board matches</div>';
}

function boardHeadHtml() {
  return `<div class="board-head"><h2>Tasks</h2>
        <div class="bpick">
          <button class="field board-pick" data-action="board-menu">${esc(boardName(S.boardSrc))} <span class="caret">▾</span></button>
          ${S.boardMenu ? `<div class="bmenu"><input class="field search" id="board-q" type="search" placeholder="Search ${allBoards().length} boards" value="${esc(S.boardQ)}">
            <div class="bm-list" id="board-list">${boardList()}</div></div>` : ''}
        </div>
        ${S.boardSrc !== homeBoard() ? `<button class="btn tiny ghost" data-action="pick-board" data-gid="${esc(homeBoard())}" title="Back to ${esc(boardName(S.defaultBoard))}">★ Default</button>` : ''}
        <span class="muted" id="board-count"></span>
        <input class="field search" id="task-q" type="search" placeholder="Search tasks" value="${esc(S.taskQ)}">
      </div>`;
}

// Build the Tasks screen once; afterwards only the header and columns are redrawn,
// so the open task (its scroll, comment draft and cursor) is never thrown away.
function renderTasks() {
  if (S.view !== 'tasks' || S.ui.widget) return;
  if ($('.tasks')) {
    keepFocus($('.board-head'), () => { $('.board-head').outerHTML = boardHeadHtml(); }); // board search / picker search keep typing
    renderBoard();
    return;
  }
  $('#app').innerHTML = `<section class="tasks">
    <div class="pane glass board-pane">
      ${boardHeadHtml()}
      <div class="board" id="board"></div>
    </div>
    <aside class="pane glass task-pane"><div class="scroll" id="task-detail"></div>${resizer('w-task', 'left')}</aside>
  </section>`;
  renderBoard(); renderTaskDetail();
}

async function openTask(gid) {
  if (isJira(gid)) return openJira(gid);
  S.taskSel = gid; S.draft = ''; S.editing = null; S.files = []; S.taskDetail = { gid, loading: true };
  loadAttachments(gid);
  loadTaskTime(gid);
  renderBoard(); renderTaskDetail();
  try {
    const [t, stories] = await Promise.all([
      api.asana(`/tasks/${gid}?opt_fields=${TASK_FIELDS},memberships.section.name,memberships.project.name,completed,custom_fields.resource_subtype,custom_fields.enum_options.name,custom_fields.enum_options.enabled`),
      asanaAll(`/tasks/${gid}/stories?opt_fields=type,text,created_at,created_by.name,is_edited`, 5),
    ]);
    if (S.taskSel === gid) S.taskDetail = { gid, task: t.data, comments: stories.filter((s) => s.type === 'comment') };
  } catch (e) { if (S.taskSel === gid) S.taskDetail = { gid, error: clean(e) }; }
  renderTaskDetail();
}

// dependency rows always open in Asana on the web (they are usually someone else's task)
function depList(title, deps) {
  if (!deps?.length) return '';
  return `<div class="sub">${title} ${openDeps(deps).length}</div>${deps.map((d) => `<a href="#" class="dep ${d.completed ? 'done' : ''}" data-action="open-link" data-url="${esc(taskUrl(d))}">
      <span class="tdot ${d.completed ? '' : title === 'Blocked by' ? 'overdue' : 'soon'}"></span>
      <span class="dep-name">${esc(d.name)}</span><span class="muted">${d.completed ? 'Done' : esc(d.assignee?.name || 'Unassigned')}</span>${I.ext}</a>`).join('')}`;
}

// your own comments can be edited in place (Asana only lets the author edit a comment)
function commentHtml(c) {
  const mine = c.created_by?.gid && c.created_by.gid === S.cfg.asana.user?.gid;
  const editing = mine && S.editing === c.gid;
  return `<div class="comment">
    <span class="avatar sm" style="--h:${hue(c.created_by?.name || 'Asana')}">${c.created_by ? esc(initials(c.created_by.name)) : I.spark}</span>
    <div><div><b>${esc(c.created_by?.name || 'Asana automation')}</b> <span class="muted">${fmtShort(new Date(c.created_at))}${c.is_edited ? ' · edited' : ''}</span>
      ${mine && !editing ? `<button class="link-btn" data-action="edit-comment" data-sid="${esc(c.gid)}">Edit</button>` : ''}</div>
      ${editing ? `<textarea class="field" id="edit-comment" rows="3">${esc(S.editDraft)}</textarea>
        <div class="row end"><button class="btn tiny ghost" data-action="edit-cancel">Cancel</button><button class="btn tiny primary" data-action="edit-save" data-sid="${esc(c.gid)}">Save</button></div>`
        : `<p>${esc(c.text)}</p>`}</div>
  </div>`;
}

// Redraw the task panel without losing your place: same task keeps its scroll position,
// and a focused comment box keeps focus and cursor position.
function renderTaskDetail() {
  const el = $('#task-detail');
  if (!el) return;
  const same = el.dataset.for === (S.taskDetail?.gid || '');
  const y = same ? el.scrollTop : 0;
  const act = document.activeElement;
  const fid = act && el.contains(act) ? act.id : '';
  const sel = fid && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
  renderTaskDetailNow();
  el.dataset.for = S.taskDetail?.gid || '';
  el.scrollTop = y;
  const f = fid && document.getElementById(fid);
  if (f) { f.focus({ preventScroll: true }); if (sel) f.setSelectionRange(sel[0], sel[1]); }
}

function renderTaskDetailNow() {
  const el = $('#task-detail');
  if (!el) return;
  const d = S.taskDetail;
  if (!d) { el.innerHTML = '<div class="empty big">Select a task<br><span class="muted">Read the thread, see related mail and comment as yourself.</span></div>'; return; }
  if (d.loading) { el.innerHTML = '<div class="shimmer-lines"><i></i><i></i><i></i></div>'; return; }
  if (d.error) { el.innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  if (d.jira) { el.innerHTML = jiraDetailHtml(d); return; }
  const t = d.task;
  const mails = threadsForTask(t.gid);
  const sections = (t.memberships || []).filter((m) => m.section).map((m) => `${m.project?.name ? esc(m.project.name) + ' · ' : ''}${esc(m.section.name)}`);
  el.innerHTML = `
    <h1 class="t-title">${esc(t.name)}</h1>
    <div class="chips">
      <span class="chip ${dueClass(t) === 'overdue' ? 'red' : dueClass(t) === 'soon' ? 'orange' : 'gray'}">${dueLabel(t)}</span>
      ${t.assignee ? `<span class="chip gray">${esc(t.assignee.name)}</span>` : ''}
      ${sections.map((s) => `<span class="chip blue">${s}</span>`).join('')}
    </div>
    <div class="row"><button class="btn ghost tiny" data-action="open-link" data-url="${esc(t.permalink_url)}">${I.ext}Open in Asana</button>${everhourControls(t.gid)}</div>
    <div class="row"><button class="btn tiny cc" data-action="handoff" data-gid="${esc(t.gid)}" title="Opens Claude Code in a new terminal with this task's description, comments, blockers and linked emails">${I.spark}Work on this in Claude Code</button></div>
    ${statusControls(t)}
    ${t.notes ? `<div class="sub">Description</div><p class="t-notes">${esc(t.notes)}</p>` : ''}
    ${attachmentsHtml(t.gid)}
    ${depList('Blocked by', t.dependencies)}
    ${depList('Blocking', t.dependents)}
    ${relatedMailHtml(mails)}
    <div class="sub">Comments ${d.comments.length ? d.comments.length : ''}</div>
    ${d.comments.map(commentHtml).join('') || '<p class="muted">No comments yet.</p>'}
    <div class="composer">
      <textarea class="field" id="comment" rows="3" placeholder="Comment as ${esc(S.cfg.asana.user?.name || 'you')}… paste or drop pictures and files here (Ctrl+Enter to post)">${esc(S.draft)}</textarea>
      <div class="pending" id="pending-files">${pendingHtml()}</div>
      <div class="row end"><label class="btn ghost tiny attach-btn" title="Attach files">${I.clip}Attach<input type="file" id="file-pick" multiple hidden></label><button class="btn primary tiny" data-action="post-comment">Comment</button></div>
    </div>`;
}

const relatedMailHtml = (mails) => (mails.length ? `<div class="sub">Related mail</div>${mails.map((m) => `<a href="#" class="mini-mail" data-action="goto-mail" data-id="${esc(m.key)}"><b>${esc(m.fromName)}</b> ${esc(m.subject)}</a>`).join('')}` : '');

// ---------- Jira (issues assigned to me, shown as tasks) ----------
const JIRA_FIELDS = ['summary', 'status', 'duedate', 'updated', 'project', 'assignee'];
async function loadJira() {
  if (!S.cfg.jira.connected) { S.jira = []; return; }
  let out = [], nextPageToken;
  for (let i = 0; i < 5; i++) { // ponytail: first 500 open issues; raise if someone has more
    const r = await api.jira('/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', fields: JIRA_FIELDS, maxResults: 100, nextPageToken }) });
    out = out.concat(r.issues || []);
    nextPageToken = r.nextPageToken;
    if (!nextPageToken || r.isLast) break;
  }
  S.jira = out.map((i) => Sources.jiraTask(S.cfg.jira.site, i));
  S.jiraLoaded = true;
}

// one column per status, in workflow order: to do, in progress, then done
const CAT_ORDER = { new: 0, indeterminate: 1, done: 2 };
function jiraColumns() {
  const cols = new Map();
  for (const t of S.jira) {
    if (!cols.has(t.status)) cols.set(t.status, { gid: t.status, name: t.status, cat: CAT_ORDER[t.statusCat] ?? 1, tasks: [] });
    cols.get(t.status).tasks.push(t);
  }
  return [...cols.values()].sort((a, b) => a.cat - b.cat || a.name.localeCompare(b.name));
}

async function openJira(gid) {
  S.taskSel = gid; S.draft = ''; S.files = []; S.taskDetail = { gid, loading: true };
  renderBoard(); renderTaskDetail();
  const key = gid.slice(5);
  try {
    const [issue, c, tr] = await Promise.all([
      api.jira(`/issue/${encodeURIComponent(key)}?fields=${JIRA_FIELDS},description,priority,issuetype,reporter&expand=renderedFields`),
      api.jira(`/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=50&expand=renderedBody`),
      api.jira(`/issue/${encodeURIComponent(key)}/transitions`),
    ]);
    if (S.taskSel === gid) S.taskDetail = { gid, jira: true, issue, task: Sources.jiraTask(S.cfg.jira.site, issue), comments: c.comments.reverse(), transitions: tr.transitions };
  } catch (e) { if (S.taskSel === gid) S.taskDetail = { gid, error: clean(e) }; }
  renderTaskDetail();
}

// Jira renders rich text to HTML; show it as plain text with its line breaks
function htmlLines(h) {
  const d = new DOMParser().parseFromString(h || '', 'text/html');
  d.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  d.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,pre,blockquote').forEach((b) => b.append('\n'));
  return d.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

function jiraDetailHtml(d) {
  const t = d.task, f = d.issue.fields;
  const chip = (x, cls = 'gray') => (x ? `<span class="chip ${cls}">${esc(x)}</span>` : '');
  return `
    <h1 class="t-title">${esc(f.summary)}</h1>
    <div class="chips">${chip(d.issue.key, 'blue')}${chip(f.issuetype?.name)}${chip(f.priority?.name, /highest|high|critical|blocker/i.test(f.priority?.name || '') ? 'orange' : 'gray')}
      <span class="chip ${dueClass(t) === 'overdue' ? 'red' : dueClass(t) === 'soon' ? 'orange' : 'gray'}">${dueLabel(t)}</span>${chip(f.project?.name, 'blue')}</div>
    <div class="row"><button class="btn ghost tiny" data-action="open-link" data-url="${esc(t.permalink_url)}">${I.ext}Open in Jira</button></div>
    <div class="status-grid">
      <label class="lbl inline"><span class="st-label">Status</span><select class="field" id="jira-transition"><option value="">${esc(f.status?.name)}</option>
        ${d.transitions.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.to?.name && x.to.name !== x.name ? ' → ' + esc(x.to.name) : ''}</option>`).join('')}</select></label>
      <label class="lbl inline"><span class="st-label">Assignee</span><span>${esc(f.assignee?.displayName || 'Unassigned')}</span></label>
      ${f.reporter ? `<label class="lbl inline"><span class="st-label">Reporter</span><span>${esc(f.reporter.displayName)}</span></label>` : ''}
    </div>
    ${d.issue.renderedFields?.description ? `<div class="sub">Description</div><p class="t-notes">${esc(htmlLines(d.issue.renderedFields.description))}</p>` : ''}
    ${relatedMailHtml(threadsForTask(t.gid))}
    <div class="sub">Comments ${d.comments.length || ''}</div>
    ${d.comments.map((c) => `<div class="comment"><span class="avatar sm" style="--h:${hue(c.author?.displayName || 'Jira')}">${esc(initials(c.author?.displayName || 'Jira'))}</span>
      <div><div><b>${esc(c.author?.displayName || 'Jira')}</b> <span class="muted">${fmtShort(new Date(c.created))}</span></div><p>${esc(c.renderedBody ? htmlLines(c.renderedBody) : c.plain || '')}</p></div></div>`).join('') || '<p class="muted">No comments yet.</p>'}
    <div class="composer">
      <textarea class="field" id="comment" rows="3" placeholder="Comment as ${esc(S.cfg.jira.user?.name || 'you')}… (Ctrl+Enter to post)">${esc(S.draft)}</textarea>
      <div class="row end"><button class="btn primary tiny" data-action="post-comment">Comment</button></div>
    </div>`;
}

// drag to a column, or pick in the detail: Jira only allows the transitions its workflow offers
async function transitionJira(gid, pick) {
  const key = gid.slice(5), t = S.jira.find((x) => x.gid === gid);
  const { transitions } = await api.jira(`/issue/${encodeURIComponent(key)}/transitions`);
  const tr = transitions.find(pick);
  if (!tr) throw new Error(`Jira's workflow has no move from ${t?.status || 'here'} to that status`);
  await api.jira(`/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: tr.id } }) });
  if (tr.to?.statusCategory?.key === 'done') S.jira = S.jira.filter((x) => x.gid !== gid); // boards only show open issues
  else if (t) { t.status = tr.to?.name || t.status; t.statusCat = tr.to?.statusCategory?.key || t.statusCat; }
  return tr.to?.name || tr.name;
}

async function moveJira(gid, status) {
  const t = S.jira.find((x) => x.gid === gid);
  if (!t || t.status === status) return;
  try {
    toast(`Moved to ${await transitionJira(gid, (x) => x.to?.name === status)}`);
    if (S.taskSel === gid) openJira(gid);
  } catch (err) { toast(`Couldn't move it: ${clean(err)}`); }
  renderBoard();
}

// ---------- Everhour timer ----------
// Asana tasks are known to Everhour as "as:<asana gid>"
const timerGid = () => (S.timer?.task?.id?.startsWith('as:') ? S.timer.task.id.slice(3) : null);
// Everhour's clock = time already logged on the task today (`today`, excludes the running session)
// + the running session (`duration`), counting on from when we fetched it.
const elapsed = () => (S.timer ? (S.timer.today || 0) + (S.timer.duration || 0) + Math.floor((Date.now() - S.timer.at) / 1000) : 0);
const fmtClock = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
const ehError = (e) => (clean(e) === 'NOT_IN_EVERHOUR' ? "This task isn't in Everhour yet. Connect its Asana project in Everhour first." : clean(e));

async function loadTimer() {
  if (!S.cfg.everhour?.connected) { S.timer = null; return; }
  const t = await api.everhour('/timers/current');
  S.timer = t?.status === 'active' ? { ...t, at: Date.now() } : null;
}

async function loadTaskTime(gid) {
  if (!S.cfg.everhour?.connected) return;
  try { S.ehTime[gid] = (await api.everhour(`/tasks/as:${gid}`)).time?.total || 0; } catch { S.ehTime[gid] = null; }
  if (S.taskSel === gid) renderTaskDetail();
}

function timerChanged() { renderTitlebar(); if (S.view === 'tasks') { renderBoard(); renderTaskDetail(); } else refreshPanes(); }

// tick like Everhour (every second) but only rewrite the few clock labels, and only while visible
setInterval(() => { if (S.timer && !document.hidden) document.querySelectorAll('.timer-txt').forEach((el) => { el.textContent = fmtClock(elapsed()); }); }, 1000);
// Timer changes made anywhere (Everhour web/extension, the dock, Claude Code) arrive as 'timer:changed'
// from the main process, which checks Everhour every 15 s for everyone. Also re-read it when the window comes back.
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cfg?.everhour?.connected) loadTimer().then(timerChanged).catch(() => {}); });

function everhourControls(gid) {
  if (!S.cfg.everhour?.connected) return '';
  const t = S.ehTime[gid];
  const logged = t === undefined ? '' : t === null ? 'Not in Everhour yet' : `${fmtDur(t)} logged`;
  return (timerGid() === gid
    ? `<button class="btn tiny danger" data-action="timer-stop">${I.stop}Stop <span class="timer-txt">${fmtClock(elapsed())}</span></button>`
    : `<button class="btn tiny primary" data-action="timer-start" data-gid="${esc(gid)}">${I.play}Start timer</button>`)
    + (logged ? `<span class="muted eh-logged">${logged}</span>` : '');
}

// ---------- drag a card to another column = move the task to that section in Asana ----------
let dragGid = null;
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('[data-drag]');
  if (!card) return;
  dragGid = card.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragGid);
  requestAnimationFrame(() => card.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  dragGid = null;
  document.querySelectorAll('.dragging, .col.drop').forEach((el) => el.classList.remove('dragging', 'drop'));
});
document.addEventListener('dragover', (e) => {
  const col = dragGid && e.target.closest?.('.col[data-col]');
  if (!col) return;
  e.preventDefault(); // allow dropping here
  document.querySelectorAll('.col.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
});
document.addEventListener('drop', (e) => {
  const col = dragGid && e.target.closest?.('.col[data-col]');
  if (!col) return;
  e.preventDefault();
  moveTask(dragGid, col.dataset.col);
});

// optimistic: move it on screen first, then tell Asana; put it back if Asana says no
async function moveTask(gid, sectionGid) {
  if (isJira(gid)) return moveJira(gid, sectionGid);
  const my = S.boardSrc === 'my';
  const cols = my ? null : S.board.columns;
  const task = S.tasks.find((t) => t.gid === gid);
  const from = my ? (task ? task.assignee_section || { gid: 'none' } : null) : cols.find((c) => c.tasks.some((t) => t.gid === gid));
  if (!from || from.gid === sectionGid) return;
  const name = (my ? myColumns() : cols).find((c) => c.gid === sectionGid)?.name;
  const apply = (target) => {
    if (my) { S.tasks.find((t) => t.gid === gid).assignee_section = target; return; }
    const src = cols.find((c) => c.tasks.some((t) => t.gid === gid));
    const task = src.tasks.find((t) => t.gid === gid);
    src.tasks = src.tasks.filter((t) => t.gid !== gid);
    cols.find((c) => c.gid === target.gid).tasks.unshift(task);
  };
  apply({ gid: sectionGid, name });
  renderBoard();
  try {
    await api.asana(`/sections/${sectionGid}/addTask`, { method: 'POST', body: JSON.stringify({ data: { task: gid } }) });
    toast(`Moved to ${name}`);
  } catch (err) {
    apply(my ? (from.gid === 'none' ? null : from) : { gid: from.gid });
    renderBoard();
    toast(`Couldn't move it: ${clean(err)}`);
  }
}

// ---------- task status: complete, section per board, dropdown custom fields ----------
const ASANA_TONE = { red: 'red', orange: 'orange', 'yellow-orange': 'orange', yellow: 'orange', 'yellow-green': 'green', green: 'green', 'blue-green': 'green', aqua: 'blue', blue: 'blue', indigo: 'purple', purple: 'purple', magenta: 'purple', 'hot-pink': 'red', pink: 'red' };
const statusField = (t) => (t.custom_fields || []).find((f) => /status/i.test(f.name) && f.enum_value);
function statusChip(t) {
  const f = statusField(t);
  return f ? `<span class="chip ${ASANA_TONE[f.enum_value.color] || 'gray'}">${esc(f.enum_value.name)}</span>` : '';
}

async function loadSections(projectGid) {
  if (S.sections[projectGid]) return;
  S.sections[projectGid] = 'loading';
  try { S.sections[projectGid] = (await api.asana(`/projects/${projectGid}/sections?opt_fields=name`)).data; } catch { S.sections[projectGid] = 'failed'; } // don't retry on every redraw
  renderTaskDetail();
}

function statusControls(t) {
  const boards = (t.memberships || []).filter((m) => m.project?.gid && m.section);
  const fields = (t.custom_fields || []).filter((f) => f.resource_subtype === 'enum' && f.enum_options?.length);
  const secOpts = (m) => {
    const list = Array.isArray(S.sections[m.project.gid]) ? S.sections[m.project.gid] : (loadSections(m.project.gid), [m.section]);
    return list.map((x) => `<option value="${esc(x.gid)}" ${x.gid === m.section.gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  };
  return `<div class="status-grid">
    <button class="btn tiny ${t.completed ? 'success' : 'ghost'}" data-action="toggle-complete">${I.check}${t.completed ? 'Completed' : 'Mark complete'}</button>
    ${boards.map((m) => `<label class="lbl inline"><span class="st-label">${esc(m.project.name)}</span><select class="field" data-sec-project="${esc(m.project.gid)}">${secOpts(m)}</select></label>`).join('')}
    ${fields.map((f) => `<label class="lbl inline"><span class="st-label">${esc(f.name)}</span><select class="field" data-cf="${esc(f.gid)}"><option value="">None</option>
      ${f.enum_options.filter((o) => o.enabled !== false || o.gid === f.enum_value?.gid).map((o) => `<option value="${esc(o.gid)}" ${o.gid === f.enum_value?.gid ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`).join('')}
  </div>`;
}

// keep the board copies of a task in step with the detail copy
const boardCopies = (gid) => [S.tasks.find((t) => t.gid === gid), ...(S.board?.columns || []).flatMap((c) => c.tasks.filter((t) => t.gid === gid))].filter(Boolean);

// ---------- appearance ----------
const BG_CHOICES = [['aurora', 'Aurora'], ['morandi', 'Morandi'], ['mist', 'Mist'], ['graphite', 'Graphite'], ['transparent', 'Transparent'], ['picture', 'Your picture']];
function applyTheme() {
  const t = S.ui.theme || { bg: 'aurora', dim: 35 };
  document.documentElement.dataset.bg = t.bg === 'picture' && !S.pic ? 'aurora' : t.bg;
  document.documentElement.style.setProperty('--dim', String((t.dim ?? 35) / 100));
  $('.wallpaper').style.backgroundImage = t.bg === 'picture' && S.pic ? `url("${S.pic}")` : '';
}
async function setTheme(patch) { S.ui = await api.setTheme(patch); applyTheme(); render(); }

// ---------- task attachments: gallery, full-size view, paste/drop/attach for comments ----------
async function loadAttachments(gid) {
  S.att[gid] = 'loading';
  try { S.att[gid] = await api.attachments(gid); } catch { S.att[gid] = []; }
  if (S.taskSel === gid) renderTaskDetail();
}
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function attachmentsHtml(gid) {
  const list = S.att[gid];
  if (list === 'loading') return '<div class="sub">Attachments</div><p class="muted">Loading…</p>';
  if (!list?.length) return '';
  const imgs = list.filter((a) => a.dataUrl), files = list.filter((a) => !a.dataUrl);
  return `<div class="sub">Attachments ${list.length}</div>
    ${imgs.length ? `<div class="att-grid">${imgs.map((a) => `<button class="att-img" data-action="lightbox" data-task="${esc(gid)}" data-att="${esc(a.gid)}" title="${esc(a.name)}"><img src="${esc(a.dataUrl)}" alt="${esc(a.name)}"></button>`).join('')}</div>` : ''}
    ${files.map((a) => `<a href="#" class="att-file" data-action="open-link" data-url="${esc(a.url)}">${I.clip}<span>${esc(a.name)}</span><span class="muted">${a.size ? kb(a.size) : ''}</span>${I.ext}</a>`).join('')}`;
}
function pendingHtml() {
  return S.files.map((f, i) => `<span class="pend">${f.preview ? `<img src="${esc(f.preview)}" alt="">` : I.clip}<span>${esc(f.name)}</span><span class="muted">${kb(f.size)}</span><button class="chip-x" data-action="remove-file" data-i="${i}" title="Remove">×</button></span>`).join('');
}
function addFiles(list) {
  for (const file of list) {
    if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is over 25 MB`); continue; }
    const d = new Date(), two = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; // local time
    const name = !file.name || /^image\.(png|jpe?g)$/i.test(file.name) ? `screenshot-${stamp}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : file.name;
    const r = new FileReader();
    r.onload = () => {
      const url = r.result;
      S.files.push({ name, type: file.type, size: file.size, base64: url.slice(url.indexOf(',') + 1), preview: file.type.startsWith('image/') ? url : '' });
      const el = $('#pending-files'); if (el) el.innerHTML = pendingHtml();
    };
    r.readAsDataURL(file);
  }
}
document.addEventListener('paste', (e) => {
  if (e.target.id !== 'comment' || !e.clipboardData?.files?.length || isJira(S.taskSel)) return;
  if (!e.clipboardData.getData('text')) e.preventDefault(); // a pure picture/file paste: don't also paste text
  addFiles(e.clipboardData.files);
});
document.addEventListener('dragover', (e) => {
  const c = e.target.closest?.('.composer');
  if (!c || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault(); c.classList.add('drop');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget?.closest?.('.composer')) document.querySelectorAll('.composer.drop').forEach((c) => c.classList.remove('drop')); });
document.addEventListener('drop', (e) => {
  const c = e.target.closest?.('.composer');
  if (!c || !e.dataTransfer?.files?.length || isJira(S.taskSel)) return;
  e.preventDefault(); c.classList.remove('drop'); addFiles(e.dataTransfer.files);
});
function showLightbox(src, name) {
  const d = document.createElement('div');
  d.className = 'lightbox'; d.id = 'lightbox';
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(name)}"><span class="lb-name">${esc(name)}</span>`;
  d.addEventListener('click', () => d.remove());
  document.body.appendChild(d);
}

// ---------- close dialog (full window only; closing the widget just returns to the full window) ----------
function showCloseDialog() {
  if ($('#close-dialog')) return;
  const d = document.createElement('div');
  d.id = 'close-dialog'; d.className = 'modal-back';
  d.innerHTML = `<div class="modal glass" role="dialog" aria-modal="true" aria-labelledby="close-title">
    <div class="app-icon sm">${I.spark}</div>
    <h2 id="close-title">Close Workmate Desk?</h2>
    <p>Keep it on your desktop as a widget, or quit it completely. You won't get notifications while it's closed.</p>
    <label class="check"><input type="checkbox" id="close-remember"> Don't ask again</label>
    <div class="modal-actions">
      <button class="btn primary" data-action="close-choose" data-choice="widget">Turn into widget</button>
      <button class="btn ghost" data-action="close-choose" data-choice="quit">Quit</button>
      <button class="btn ghost" data-action="close-choose" data-choice="cancel">Cancel</button>
    </div></div>`;
  document.body.appendChild(d);
  d.querySelector('[data-choice=widget]').focus();
}
api.onCloseRequest(showCloseDialog);

// ---------- notices (Windows notifications) ----------
const noEvt = { preventDefault() {}, stopPropagation() {} };

function notify(title, body, onClick) {
  if (store.get('notify') === false) return;
  const n = new Notification(title, { body });
  n.onclick = () => { api.showWindow(); onClick(); };
}

// After each refresh: tasks and Jira issues newly assigned to me, and urgent unread mail not announced before.
// The first run of each only records what exists, so you aren't flooded on day one.
function noticeNew(storeKey, list, label) {
  const prev = store.get(storeKey);
  if (prev) {
    const seen = new Set(prev), fresh = list.filter((t) => !seen.has(t.gid));
    if (fresh.length === 1) notify(`New ${label} for you`, fresh[0].name, () => actions['goto-task']({ dataset: { gid: fresh[0].gid } }, noEvt));
    else if (fresh.length > 1) notify(`${fresh.length} new ${label}s for you`, fresh.slice(0, 3).map((t) => t.name).join('\n'), () => { S.view = 'tasks'; render(); });
  }
  store.set(storeKey, list.map((t) => t.gid));
}
function checkNotices() {
  if (S.tasksLoaded) noticeNew('seenTasks', S.tasks, 'Asana task');
  if (S.jiraLoaded) noticeNew('seenJira', S.jira, 'Jira issue');
  const first = store.get('seenUrgent') === null;
  const told = new Set(store.get('seenUrgent') || []);
  const urgent = heads(S.emails).filter((m) => m.u?.level === 'urgent' && m.labelIds.includes('UNREAD') && !isNoise(m) && !told.has(m.key));
  if (!first) for (const m of urgent.slice(0, 3)) notify(`Urgent: ${m.fromName}`, m.subject, () => actions['goto-mail']({ dataset: { id: m.key } }, noEvt));
  store.set('seenUrgent', [...told, ...urgent.map((m) => m.key)].slice(-500));
}

// ---------- resizable panes (drag the edge; double-click resets) ----------
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.resizer');
  if (!h) return;
  const pane = h.parentElement, dir = h.dataset.dir === 'left' ? -1 : 1;
  const startX = e.clientX, startW = pane.getBoundingClientRect().width, name = `--${h.dataset.resize}`;
  // Pointer events only: cancelling pointerdown suppresses the legacy mouse events, so mixing the two
  // would never see the release and leave the drag stuck on. Any way the drag can end, ends it.
  e.preventDefault();
  try { h.setPointerCapture(e.pointerId); } catch {} // keeps the release even if it happens outside the window
  document.body.classList.add('resizing'); // also stops the email iframe from swallowing the drag
  const move = (ev) => document.documentElement.style.setProperty(name, `${Math.round(Math.max(220, Math.min(900, startW + (ev.clientX - startX) * dir)))}px`);
  const end = () => {
    window.removeEventListener('pointermove', move);
    ['pointerup', 'pointercancel', 'blur'].forEach((t) => window.removeEventListener(t, end));
    h.removeEventListener('lostpointercapture', end);
    document.body.classList.remove('resizing');
    store.set('size' + name, document.documentElement.style.getPropertyValue(name));
  };
  window.addEventListener('pointermove', move);
  ['pointerup', 'pointercancel', 'blur'].forEach((t) => window.addEventListener(t, end));
  h.addEventListener('lostpointercapture', end);
});
document.addEventListener('dblclick', (e) => {
  const h = e.target.closest('.resizer');
  if (h) { document.documentElement.style.removeProperty(`--${h.dataset.resize}`); store.set(`size--${h.dataset.resize}`, null); }
});
for (const n of ['w-list', 'w-focus', 'w-task', 'w-cal']) { const v = store.get(`size--${n}`); if (v) document.documentElement.style.setProperty(`--${n}`, v); }
const resizer = (name, dir) => `<div class="resizer ${dir}" data-resize="${name}" data-dir="${dir}" title="Drag to resize, double-click to reset"></div>`;

// ---------- widget ----------
// A widget list shows everything; past 5 rows it scrolls, with a fade and a bouncing "N more" hint
function wList(items, rowHtml, empty) {
  if (!items.length) return `<p class="muted">${empty}</p>`;
  const more = items.length - 5;
  return `<div class="w-list ${more > 0 ? 'scrolls' : ''}">${items.map(rowHtml).join('')}</div>`
    + (more > 0 ? `<div class="scroll-hint">${I.down}<span>${more} more</span></div>` : '');
}

function renderWidget() {
  const now = new Date();
  // everything still to come in the next 24 hours (not all-day, declined or hidden by you)
  const upcoming = S.events.filter((e) => evEnd(e) > now && evStart(e) - now < DAY && !e.start.date && !declined(e) && !isHiddenEv(e)).sort((a, b) => evStart(a) - evStart(b));
  const urgent = heads(S.emails).filter((m) => m.u && m.u.level !== 'normal' && !isNoise(m)).sort((a, b) => b.u.score - a.u.score);
  const linked = signalGids();
  const due = allTasks().map((t) => ({ t, s: Urgency.taskSignal(t, linked, now) })).filter((x) => x.s.signal && x.s.rank <= 3).sort((a, b) => a.s.rank - b.s.rank);
  const when = (e) => {
    const mins = Math.round((evStart(e) - now) / 60000);
    return mins <= 0 ? 'Now' : mins < 60 ? `in ${mins} min` : sameDay(evStart(e), now) ? fmtTime(evStart(e)) : `Tomorrow ${fmtTime(evStart(e))}`;
  };
  return `<section class="widget">
    ${S.timer ? `<div class="glass w-card"><h3><span class="rec"></span>Tracking</h3><div class="w-next"><span class="w-when timer-txt">${fmtClock(elapsed())}</span><b>${esc(S.timer.task?.name || 'Timer')}</b>
      <button class="btn tiny" data-action="timer-stop">${I.stop}Stop</button></div></div>` : ''}
    <div class="glass w-card"><h3>Up next <span class="count blue">${upcoming.length || ''}</span></h3>
      ${wList(upcoming, (e, i) => `<div class="w-ev ${i === 0 ? 'first' : ''}"><span class="w-when">${when(e)}</span><span class="w-ev-name">${esc(e.summary || '(busy)')}</span>
        ${e.hangoutLink ? `<button class="btn tiny" data-action="open-link" data-url="${esc(e.hangoutLink)}">Join</button>` : ''}</div>`, 'No more meetings today')}</div>
    <div class="glass w-card"><h3>Needs attention <span class="count">${urgent.length || ''}</span></h3>
      ${wList(urgent, (m) => `<button class="w-mail lv-${m.u.level}" data-action="goto-mail" data-id="${esc(m.key)}"><span class="avatar sm" style="--h:${hue(m.fromAddr)}">${esc(initials(m.fromName))}</span>
        <span><b>${esc(m.fromName)}</b><span class="muted">${esc(S.ai[aiKey(m)]?.summary || m.subject)}</span></span></button>`, 'Inbox is calm')}</div>
    ${tasksOn() ? `<div class="glass w-card"><h3>Due soon <span class="count orange">${due.length || ''}</span></h3>
      ${wList(due, ({ t, s }) => `<a href="#" class="focus-item" data-action="goto-task" data-gid="${esc(t.gid)}"><span class="tdot ${dueClass(t)}"></span><span><span class="fi-name">${esc(t.name)}</span><span class="muted">${esc(s.why)}</span></span></a>`, 'Nothing due')}</div>` : ''}
    <div class="w-more">${I.down}<span>More below</span></div>
  </section>`;
}

// size each scrolling list to exactly 5 rows, and drop the hint once you reach the end
function fitWidgetLists() {
  document.querySelectorAll('.w-list.scrolls').forEach((el) => {
    const rows = el.children;
    el.style.maxHeight = `${rows[5].getBoundingClientRect().top - rows[0].getBoundingClientRect().top}px`;
    el.classList.toggle('at-end', el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  });
  markWidgetMore();
}

// the widget as a whole: show 'More below' while cards are hidden under the bottom edge
function markWidgetMore() {
  const w = document.querySelector('.widget');
  if (w) w.classList.toggle('has-more', w.scrollTop + w.clientHeight < w.scrollHeight - 4);
}
window.addEventListener('resize', () => { if (S.ui.widget && S.view !== 'setup') fitWidgetLists(); });
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (el.classList?.contains('w-list')) el.classList.toggle('at-end', el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  if (el.classList?.contains('widget')) markWidgetMore();
}, true);

// ---------- Salesforce Cases ----------
const sfq = (soql) => api.sf(`/query?q=${encodeURIComponent(soql)}`);
const CASE_FIELDS = 'Id, CaseNumber, Subject, Status, Priority, IsClosed, OwnerId, Owner.Name, Account.Name, Contact.Name, LastModifiedDate';
const CASE_SCOPES = [['mine', 'My open'], ['open', 'All open'], ['all', 'All']];
const caseUrl = (id) => `${S.cfg.salesforce.instanceUrl}/lightning/r/Case/${id}/view`;
const prioTone = (p) => (/critical|urgent/i.test(p || '') ? 'red' : /high/i.test(p || '') ? 'orange' : 'gray');
const later = (fn, ms = 350) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

async function loadCases() {
  const c = S.cases, seq = (c.seq = (c.seq || 0) + 1);
  const where = [];
  if (c.scope === 'mine') where.push(`OwnerId = '${Sources.soql(S.cfg.salesforce.user?.id || '')}'`);
  if (c.scope !== 'all') where.push('IsClosed = false');
  const q = c.q.trim();
  if (q) where.push(`(Subject LIKE '%${Sources.soqlLike(q)}%' OR CaseNumber LIKE '%${Sources.soqlLike(q)}%')`);
  c.loading = true; renderCases();
  try {
    const r = await sfq(`SELECT ${CASE_FIELDS} FROM Case${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY LastModifiedDate DESC LIMIT 200`);
    if (seq !== c.seq) return; // a newer search is on its way
    c.list = r.records; c.error = '';
  } catch (e) { if (seq !== c.seq) return; c.error = clean(e); }
  c.loading = false; c.loaded = true;
  renderCases();
}
const searchCasesSoon = later(loadCases);

// Status and Priority choices are set up per org, so read them from Salesforce once
async function caseMeta() {
  if (!S.cases.meta) {
    const d = await api.sf('/sobjects/Case/describe');
    const values = (n) => d.fields.find((f) => f.name === n)?.picklistValues || [];
    const pick = (n) => values(n).filter((v) => v.active).map((v) => v.value);
    S.cases.meta = { status: pick('Status'), priority: pick('Priority'), defPriority: values('Priority').find((v) => v.defaultValue)?.value || '' };
  }
  return S.cases.meta;
}

async function openCase(id) {
  if (!Sources.sfId(id)) return;
  const c = S.cases;
  c.sel = id; c.form = null; c.draft = ''; c.ownerQ = ''; c.owners = []; c.detail = { id, loading: true };
  renderCases();
  try {
    const [rec, com] = await Promise.all([
      sfq(`SELECT ${CASE_FIELDS}, Description, Type, ContactEmail FROM Case WHERE Id = '${id}'`),
      sfq(`SELECT Id, CommentBody, CreatedDate, CreatedBy.Name, IsPublished FROM CaseComment WHERE ParentId = '${id}' ORDER BY CreatedDate ASC LIMIT 200`),
      caseMeta(),
    ]);
    if (!rec.records.length) throw new Error('This case no longer exists, or you lost access to it');
    if (c.sel === id) c.detail = { id, rec: rec.records[0], comments: com.records };
  } catch (e) { if (c.sel === id) c.detail = { id, error: clean(e) }; }
  renderCases();
}

async function patchCase(fields, msg) {
  const id = S.cases.detail.id;
  await api.sf(`/sobjects/Case/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
  toast(msg);
  openCase(id); loadCases();
}

async function searchOwners() {
  const c = S.cases, q = c.ownerQ.trim();
  const r = q ? await sfq(`SELECT Id, Name FROM User WHERE IsActive = true AND UserType = 'Standard' AND Name LIKE '%${Sources.soqlLike(q)}%' ORDER BY Name LIMIT 8`).catch((e) => { toast(clean(e)); return { records: [] }; }) : { records: [] };
  if (q !== c.ownerQ.trim()) return;
  c.owners = r.records;
  const el = $('#owner-results'); if (el) el.innerHTML = ownerResults();
}
const searchOwnersSoon = later(searchOwners, 300);
const ownerResults = () => S.cases.owners.map((u) => `<div class="task-row"><span class="tr-main">${esc(u.Name)}</span><button class="btn tiny" data-action="case-owner" data-id="${esc(u.Id)}" data-name="${esc(u.Name)}">Assign</button></div>`).join('')
  || (S.cases.ownerQ.trim() ? '<p class="muted">Nobody matches</p>' : '');

const caseItem = (r) => `<button class="mail-item ${S.cases.sel === r.Id ? 'sel' : ''}" data-action="open-case" data-id="${esc(r.Id)}">
    <span class="mi"><span class="mi-top"><span class="mi-from">${esc(r.CaseNumber)}${r.Account?.Name ? ' · ' + esc(r.Account.Name) : ''}</span><span class="mi-time">${fmtShort(new Date(r.LastModifiedDate))}</span></span>
      <span class="mi-subj">${esc(r.Subject || '(no subject)')}</span>
      <span class="chips"><span class="chip ${r.IsClosed ? 'green' : 'blue'}">${esc(r.Status)}</span>${r.Priority ? `<span class="chip ${prioTone(r.Priority)}">${esc(r.Priority)}</span>` : ''}${r.Owner?.Name ? `<span class="chip gray">${esc(r.Owner.Name)}</span>` : ''}</span></span></button>`;

function caseDetailHtml() {
  const c = S.cases, f = c.form;
  if (f) {
    return `<h1 class="t-title">New case</h1>
      ${f.fromMail ? `<p class="muted">From the email “${esc(f.fromMail)}”</p>` : ''}
      <label class="lbl">Subject<input class="field" id="case-subject" data-case-form="Subject" value="${esc(f.Subject)}"></label>
      <label class="lbl">Description<textarea class="field" id="case-desc" data-case-form="Description" rows="8">${esc(f.Description)}</textarea></label>
      <label class="lbl">Priority<select class="field" id="case-prio" data-case-form="Priority">${(c.meta?.priority || []).map((p) => `<option ${p === f.Priority ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <div class="row end"><button class="btn ghost" data-action="case-cancel">Cancel</button><button class="btn primary" data-action="case-save">Create case</button></div>`;
  }
  const d = c.detail;
  if (!d) return '<div class="empty big">Select a case<br><span class="muted">Change its status, priority or owner, and comment as yourself.</span></div>';
  if (d.loading) return '<div class="shimmer-lines"><i></i><i></i><i></i></div>';
  if (d.error) return `<div class="empty">${esc(d.error)}</div>`;
  const r = d.rec;
  const pick = (field, opts) => `<label class="lbl inline"><span class="st-label">${field}</span><select class="field" data-case-field="${field}">
      ${[...new Set([r[field], ...opts].filter(Boolean))].map((o) => `<option ${o === r[field] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  return `<h1 class="t-title">${esc(r.Subject || '(no subject)')}</h1>
    <div class="chips"><span class="chip blue">Case ${esc(r.CaseNumber)}</span>${r.Type ? `<span class="chip gray">${esc(r.Type)}</span>` : ''}${r.Account?.Name ? `<span class="chip gray">${esc(r.Account.Name)}</span>` : ''}
      ${r.Contact?.Name ? `<span class="chip gray">${esc(r.Contact.Name)}${r.ContactEmail ? ' · ' + esc(r.ContactEmail) : ''}</span>` : ''}</div>
    <div class="row"><button class="btn ghost tiny" data-action="open-link" data-url="${esc(caseUrl(r.Id))}">${I.ext}Open in Salesforce</button></div>
    <div class="status-grid">
      ${pick('Status', c.meta.status)}
      ${pick('Priority', c.meta.priority)}
      <label class="lbl inline"><span class="st-label">Owner</span><span class="grow">${esc(r.Owner?.Name || '')}</span>${r.OwnerId !== S.cfg.salesforce.user?.id ? '<button class="btn tiny ghost" data-action="case-take">Assign to me</button>' : ''}</label>
      <input class="field search wide" id="owner-q" type="search" placeholder="Reassign: search people by name" value="${esc(c.ownerQ)}">
      <div class="search-results wide" id="owner-results">${ownerResults()}</div>
    </div>
    ${r.Description ? `<div class="sub">Description</div><p class="t-notes">${esc(r.Description)}</p>` : ''}
    <div class="sub">Comments ${d.comments.length || ''}</div>
    ${d.comments.map((x) => `<div class="comment"><span class="avatar sm" style="--h:${hue(x.CreatedBy?.Name || 'Salesforce')}">${esc(initials(x.CreatedBy?.Name || 'Salesforce'))}</span>
      <div><div><b>${esc(x.CreatedBy?.Name || 'Salesforce')}</b> <span class="muted">${fmtShort(new Date(x.CreatedDate))}${x.IsPublished ? ' · public' : ''}</span></div><p>${esc(x.CommentBody || '')}</p></div></div>`).join('') || '<p class="muted">No comments yet.</p>'}
    <div class="composer">
      <textarea class="field" id="case-comment" rows="3" placeholder="Internal comment as ${esc(S.cfg.salesforce.user?.name || 'you')}… (Ctrl+Enter to post)">${esc(c.draft)}</textarea>
      <div class="row end"><button class="btn primary tiny" data-action="case-comment">Comment</button></div>
    </div>`;
}

// list and detail redraw in place: typing in a search or comment box keeps focus, the detail keeps its scroll
function renderCases() {
  if (S.view !== 'cases' || S.ui.widget) return;
  if (!$('.cases')) {
    $('#app').innerHTML = `<section class="cases">
      <div class="pane glass list-pane"><div class="pane-head" id="cases-head"></div><div class="scroll" id="cases-list"></div>${resizer('w-list', 'right')}</div>
      <div class="pane glass detail-pane"><div class="scroll" id="case-detail"></div></div></section>`;
  }
  const c = S.cases;
  keepFocus($('#cases-head'), () => {
    $('#cases-head').innerHTML = `<div class="ph-row"><h2>Cases</h2><button class="btn tiny primary" data-action="case-new">New case</button></div>
      <input class="field search" id="case-q" type="search" placeholder="Search subject or case number" value="${esc(c.q)}">
      <div class="seg small">${CASE_SCOPES.map(([v, l]) => `<button class="${c.scope === v ? 'on' : ''}" data-action="case-scope" data-scope="${v}">${l}</button>`).join('')}</div>`;
  });
  $('#cases-list').innerHTML = c.error ? `<div class="empty">${esc(c.error)}</div>` : !c.loaded ? '<div class="empty">Loading cases…</div>'
    : c.list.map(caseItem).join('') || '<div class="empty">No cases here</div>';
  const pane = $('#case-detail'), for_ = c.form ? 'form' : c.sel || '';
  const y = pane.dataset.for === for_ ? pane.scrollTop : 0;
  keepFocus(pane, () => { pane.innerHTML = caseDetailHtml(); });
  pane.dataset.for = for_; pane.scrollTop = y;
}

// ---------- render ----------
function render() {
  document.body.classList.toggle('is-widget', !!S.ui.widget && S.view !== 'setup');
  renderTitlebar();
  const app = $('#app');
  if (S.view === 'setup') { // redraw Settings in place: keep the scroll position
    const y = $('.setup')?.scrollTop || 0;
    app.innerHTML = renderSetup();
    $('.setup').scrollTop = y;
    return;
  }
  if (S.ui.widget) { app.innerHTML = renderWidget(); fitWidgetLists(); return; }
  if (S.view === 'calendar') { renderCalendar(); return; }
  if (S.view === 'cases') { renderCases(); return; }
  // already showing Tasks or Mail: update in place so the open task/email keeps its scroll, focus and draft
  if (S.view === 'tasks') { renderTasks(); return; }
  if ($('.mail')) { renderList(); renderDetailHead(); renderFocus(); if (S.bodyFor !== S.sel) renderDetailBody(); return; }
  app.innerHTML = mailSkeleton();
  renderList(); renderDetailHead(); renderDetailBody(); renderFocus();
}

// update data-driven parts without rebuilding inputs or reloading the email iframe
function refreshPanes() {
  if (S.view === 'setup') return;
  if (S.ui.widget) { $('#app').innerHTML = renderWidget(); fitWidgetLists(); return; }
  if (S.view === 'calendar') { renderCalendar(); return; }
  if (S.view === 'tasks') { renderBoard(); return; }
  if (S.view === 'cases') return;
  renderList(); renderDetailHead(); renderFocus();
}

// Opening an email marks its whole conversation read in its own mailbox, like Gmail and Outlook do.
async function markRead(m) {
  if (!m.labelIds.includes('UNREAD') || !acctOf(m.acct)?.canModify) return;
  m.labelIds = m.labelIds.filter((l) => l !== 'UNREAD'); // optimistic
  rescore(); refreshPanes();
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    if (m.provider === 'microsoft') {
      const r = await api.mail(m.acct, `${GRAPH}/messages?$filter=conversationId eq ${odataStr(m.threadId)} and isRead eq false&$select=id&$top=50`);
      await Promise.all((r.value || []).map((x) => api.mail(m.acct, `${GRAPH}/messages/${encodeURIComponent(x.id)}`, json('PATCH', { isRead: true }))));
    } else await api.mail(m.acct, `${GMAIL}/threads/${m.threadId}/modify`, json('POST', { removeLabelIds: ['UNREAD'] }));
  } catch (e) {
    m.labelIds.push('UNREAD'); rescore(); refreshPanes();
    toast(`Couldn't mark as read: ${clean(e)}`);
  }
}

function openMail(key) {
  if (S.sel !== key) S.linkQ = '';
  S.sel = key;
  renderList(); renderDetailHead(); renderDetailBody();
  const m = selectedEmail();
  if (m) { analyze(m); groupOf(m).forEach(markRead); }
}

// ---------- actions ----------
async function busy(btn, label, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { await fn(); } catch (e) { toast(clean(e)); btn.disabled = false; btn.textContent = old; }
}

const actions = {
  tab: (el) => {
    S.view = el.dataset.tab;
    if (S.view === 'cases' && !S.cases.loaded && !S.cases.loading) loadCases();
    // first visit to Tasks this session opens the default board
    if (S.view === 'tasks' && !S.boardOpened) { S.boardOpened = true; if (homeBoard() !== 'my') { renderTitlebar(); loadBoard(homeBoard()); return; } }
    render();
  },
  refresh: () => loadAll(),
  pin: async () => { S.ui = await api.pin(!S.ui.pinned); renderTitlebar(); },
  widget: async () => { S.ui = await api.widget(!S.ui.widget); render(); },
  settings: () => { S.view = 'setup'; S.fromSettings = true; render(); },
  'open-link': (el, e) => { e.preventDefault(); e.stopPropagation(); api.open(el.dataset.url); },

  'google-connect': (el) => busy(el, 'Waiting for browser…', async () => {
    S.cfg = await api.googleConnect($('#g-id').value, $('#g-secret').value); render();
  }),
  'ms-connect': (el) => busy(el, 'Waiting for browser…', async () => { S.cfg = await api.msConnect($('#ms-id').value, $('#ms-tenant').value); render(); }),
  // same app credentials, fresh consent; also how an expired sign-in comes back
  'acct-reconnect': (el) => busy(el, 'Waiting for browser…', async () => {
    S.cfg = await api.accountReconnect(el.dataset.id);
    if (S.view === 'setup') { render(); return; }
    renderDetailHead(); const m = selectedEmail(); if (m) markRead(m);
  }),
  'acct-remove': async (el) => {
    const id = el.dataset.id;
    S.cfg = await api.accountRemove(id);
    S.emails = S.emails.filter((m) => m.acct !== id); delete S.mailNext[id];
    if (S.acctFilter === id) S.acctFilter = '';
    render();
  },
  'jira-connect': (el) => busy(el, 'Checking…', async () => { S.cfg = await api.jiraConnect($('#j-site').value, $('#j-email').value, $('#j-token').value); render(); }),
  'jira-disconnect': async () => { S.cfg = await api.jiraDisconnect(); S.jira = []; S.jiraLoaded = false; if (S.boardSrc === 'jira') S.boardSrc = 'my'; render(); },
  'sf-connect': (el) => busy(el, 'Waiting for browser…', async () => { S.cfg = await api.sfConnect($('#sf-id').value, $('#sf-login').value); render(); }),
  'sf-disconnect': async () => {
    S.cfg = await api.sfDisconnect();
    Object.assign(S.cases, { list: [], loaded: false, sel: null, detail: null, form: null, meta: null });
    render();
  },
  'asana-connect': (el) => busy(el, 'Checking…', async () => { S.cfg = await api.asanaConnect($('#a-pat').value); S.utl = null; render(); }),
  'asana-disconnect': async () => { S.cfg = await api.asanaDisconnect(); S.tasks = []; S.boards = []; S.utl = null; render(); },
  'ai-connect': (el) => busy(el, 'Checking…', async () => { S.cfg = await api.aiConnect($('#ai-key').value); render(); }),
  'ai-disconnect': async () => { S.cfg = await api.aiDisconnect(); render(); },
  'ai-claudecode': async (el) => {
    const old = el.textContent; el.disabled = true; el.textContent = 'Checking…';
    try { S.cfg = await api.aiClaudeCode(); S.ccMissing = false; render(); } catch (e) {
      if (clean(e) === 'CLAUDE_MISSING') { S.ccMissing = true; render(); } else { toast(clean(e)); el.disabled = false; el.textContent = old; }
    }
  },
  'ai-platform': async (el) => {
    const old = el.textContent; el.disabled = true; el.textContent = 'Waiting for browser…';
    try { S.cfg = await api.aiPlatform(); S.antMissing = false; render(); } catch (e) {
      const msg = clean(e);
      if (msg === 'ANT_MISSING') { S.antMissing = true; render(); } else { toast(msg); el.disabled = false; el.textContent = old; }
    }
  },
  'setup-done': () => { S.view = 'mail'; S.fromSettings = false; render(); loadAll(); },

  filter: (el) => { S.filter = el.dataset.f; renderList(); },
  'open-mail': (el) => openMail(el.dataset.id),
  'goto-mail': async (el, e) => {
    e.preventDefault(); e.stopPropagation();
    if (S.ui.widget) S.ui = await api.widget(false);
    S.view = 'mail'; S.filter = 'all'; S.q = ''; S.sel = el.dataset.id; render();
    const m = selectedEmail(); if (m) { regroup(); analyze(m); groupOf(m).forEach(markRead); }
  },
  'set-urg': async (el) => {
    S.urg = await api.setUrgency(el.dataset.kind, el.dataset.key, el.dataset.level);
    rescore(); refreshPanes();
  },
  reanalyze: () => { const m = selectedEmail(); if (m) analyze(m, true); },
  link: (el) => { const m = selectedEmail(); S.linkQ = ''; setLinks(m.key, [...(S.links[m.key] || []), el.dataset.gid]); },
  unlink: (el) => { const m = selectedEmail(); setLinks(m.key, (S.links[m.key] || []).filter((g) => g !== el.dataset.gid)); },
  'create-task': (el) => busy(el, 'Creating…', async () => {
    const m = selectedEmail();
    const name = el.dataset.name || m.subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '');
    const notes = `From: ${m.from}\nSubject: ${m.subject}\n${providerName(m.provider)}: ${m.webUrl}\n\n${S.ai[aiKey(m)]?.summary || m.snippet}`;
    const r = await api.asana('/tasks?opt_fields=name,due_on,due_at,notes,permalink_url,modified_at,projects.name', {
      method: 'POST',
      body: JSON.stringify({ data: { name, notes, assignee: S.cfg.asana.user.gid, workspace: S.cfg.asana.workspaceGid } }),
    });
    S.tasks.push(r.data);
    await setLinks(m.key, [...(S.links[m.key] || []), r.data.gid]);
    toast(`Created “${name}” in Asana and linked it`);
  }),
  noise: () => { S.showNoise = !S.showNoise; renderFocus(); },
  'open-task': (el) => openTask(el.dataset.gid),
  lightbox: (el) => { const a = (S.att[el.dataset.task] || []).find((x) => x.gid === el.dataset.att); if (a) showLightbox(a.dataUrl, a.name); },
  'remove-file': (el) => { S.files.splice(+el.dataset.i, 1); $('#pending-files').innerHTML = pendingHtml(); },
  handoff: (el) => busy(el, 'Opening Claude Code…', async () => {
    const dir = await api.handoff(el.dataset.gid);
    el.disabled = false; el.innerHTML = `${I.spark}Work on this in Claude Code`;
    toast(`Claude Code opened with this task. Its notes go in ${dir.split('\\').slice(-2).join('\\')}`);
  }),
  'mcp-enable': (el) => busy(el, 'Connecting…', async () => { S.cfg = await api.mcpEnable(); render(); toast('Claude Code can now use Workmate Desk. Start a new Claude Code session to try it.'); }),
  'mcp-disable': async () => { S.cfg = await api.mcpDisable(); render(); toast('Claude Code connection removed'); },
  'set-bg': (el) => setTheme({ bg: el.dataset.bg }),
  'set-mode': (el) => setTheme({ mode: el.dataset.mode }),
  'pick-wallpaper': async () => {
    try {
      const r = await api.pickWallpaper();
      if (!r) return; // cancelled
      S.pic = r.url; S.ui = r.ui; applyTheme(); render();
    } catch (e) { toast(clean(e)); }
  },
  'toggle-complete': (el) => busy(el, 'Saving…', async () => {
    const t = S.taskDetail.task, done = !t.completed;
    await api.asana(`/tasks/${t.gid}`, { method: 'PUT', body: JSON.stringify({ data: { completed: done } }) });
    t.completed = done;
    if (done) { // boards only show open tasks
      S.tasks = S.tasks.filter((x) => x.gid !== t.gid);
      (S.board?.columns || []).forEach((c) => { c.tasks = c.tasks.filter((x) => x.gid !== t.gid); });
    } else if (t.assignee?.gid === S.cfg.asana.user?.gid && !S.tasks.some((x) => x.gid === t.gid)) S.tasks.push(t);
    renderBoard(); renderTaskDetail();
    toast(done ? `Completed "${t.name}". Click Completed to reopen it.` : 'Task reopened');
  }),
  'close-choose': async (el) => {
    const choice = el.dataset.choice, remember = $('#close-remember')?.checked;
    $('#close-dialog')?.remove();
    if (choice === 'cancel') return;
    if (remember) S.ui = await api.setCloseAction(choice);
    if (choice === 'quit') api.quit(); else { S.ui = await api.widget(true); render(); }
  },
  'timer-start': (el) => busy(el, 'Starting…', async () => {
    const gid = el.dataset.gid;
    try { S.timer = { ...(await api.everhour('/timers', { method: 'POST', body: JSON.stringify({ task: `as:${gid}` }) })), at: Date.now() }; }
    catch (e) { throw new Error(ehError(e)); }
    timerChanged();
  }),
  'timer-stop': async (el, e) => {
    e.stopPropagation();
    const gid = timerGid();
    try { await api.everhour('/timers/current', { method: 'DELETE' }); } catch (err) { toast(ehError(err)); return; }
    S.timer = null; timerChanged();
    if (gid) loadTaskTime(gid);
    toast('Timer stopped, time saved to Everhour');
  },
  'everhour-connect': (el) => busy(el, 'Checking…', async () => { S.cfg = await api.everhourConnect($('#eh-key').value); render(); }),
  'everhour-disconnect': async () => { S.cfg = await api.everhourDisconnect(); S.timer = null; render(); },
  'load-more': (el) => busy(el, 'Loading…', async () => {
    const r = await fetchMail(50, S.mailNext, new Set(S.emails.map((m) => m.key)));
    S.emails = [...S.emails, ...r.emails].sort((x, y) => y.date - x.date); S.mailNext = { ...S.mailNext, ...r.next };
    rescore(); renderList(); renderFocus();
  }),
  mute: async (el) => {
    const a = el.dataset.addr;
    const on = S.muted.some((p) => mutes(a, p));
    S.muted = await api.setFilters(on ? S.muted.filter((p) => !mutes(a, p)) : [...S.muted, a]);
    toast(on ? 'Sender unmuted' : 'Sender muted. Manage the list in Settings');
    refreshPanes();
  },
  'filter-add': async () => {
    const v = $('#mute-add').value.trim().toLowerCase().replace(/^@/, '');
    if (!/^[^\s@]+(@[^\s@]+)?\.[^\s@]+$/.test(v) && !/^[^\s@]+@[^\s@]+$/.test(v)) { toast('Enter an email address or a domain like everhour.com'); return; }
    S.muted = await api.setFilters([...S.muted, v]); render();
  },
  'filter-remove': async (el) => { S.muted = await api.setFilters(S.muted.filter((p) => p !== el.dataset.p)); render(); },
  'board-menu': () => { S.boardMenu = !S.boardMenu; S.boardQ = ''; renderTasks(); $('#board-q')?.focus(); },
  'pick-board': (el) => { S.boardMenu = false; S.pickedBoard = true; loadBoard(el.dataset.gid); },
  'default-board': (el, e) => {
    e.stopPropagation();
    S.defaultBoard = el.dataset.gid; store.set('defaultBoard', S.defaultBoard);
    $('#board-list').innerHTML = boardList();
    toast(`${boardName(S.defaultBoard)} is now your default board`);
  },
  'goto-task': async (el, e) => {
    e.preventDefault(); e.stopPropagation();
    if (S.ui.widget) S.ui = await api.widget(false);
    S.view = 'tasks'; S.boardOpened = true;
    const target = boardForTask(el.dataset.gid);
    if (target !== 'my' && (S.boardSrc !== target || !S.board || S.board.src !== target)) { renderTitlebar(); loadBoard(target); } else { S.boardSrc = target; render(); }
    openTask(el.dataset.gid);
  },
  'edit-comment': (el) => {
    const c = S.taskDetail.comments.find((x) => x.gid === el.dataset.sid);
    S.editing = c.gid; S.editDraft = c.text; renderTaskDetail();
    const ta = $('#edit-comment'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  },
  'edit-cancel': () => { S.editing = null; renderTaskDetail(); },
  'edit-save': (el) => busy(el, 'Saving…', async () => {
    const c = S.taskDetail.comments.find((x) => x.gid === el.dataset.sid), text = $('#edit-comment').value.trim();
    if (!text) throw new Error("A comment can't be empty");
    if (text !== c.text) {
      await api.asana(`/stories/${c.gid}`, { method: 'PUT', body: JSON.stringify({ data: { text } }) });
      c.text = text; c.is_edited = true;
    }
    S.editing = null; renderTaskDetail(); toast('Comment updated in Asana');
  }),
  'post-comment': (el) => busy(el, S.files.length ? 'Uploading…' : 'Posting…', async () => {
    const gid = S.taskSel, files = [...S.files];
    let text = $('#comment').value.trim();
    if (isJira(gid)) {
      if (!text) throw new Error('Write a comment first');
      const r = await api.jira(`/issue/${encodeURIComponent(gid.slice(5))}/comment?expand=renderedBody`, { method: 'POST', body: JSON.stringify({ body: Sources.adf(text) }) });
      if (S.taskDetail?.gid === gid) { S.taskDetail.comments.push({ ...r, plain: text }); S.draft = ''; renderTaskDetail(); }
      toast('Comment posted to Jira');
      return;
    }
    if (!text && !files.length) throw new Error('Write a comment or attach a file first');
    for (const f of files) await api.upload(gid, { name: f.name, type: f.type, base64: f.base64 });
    if (files.length) { text += `${text ? '\n\n' : ''}📎 Attached: ${files.map((f) => f.name).join(', ')}`; S.files = []; loadAttachments(gid); }
    const r = await api.asana(`/tasks/${gid}/stories?opt_fields=type,text,created_at,created_by.name,is_edited`, {
      method: 'POST', body: JSON.stringify({ data: { text } }),
    });
    if (S.taskDetail?.gid === gid) { S.taskDetail.comments.push(r.data); S.draft = ''; renderTaskDetail(); }
    toast('Comment posted to Asana');
  }),

  'open-case': (el) => openCase(el.dataset.id),
  'case-scope': (el) => { S.cases.scope = el.dataset.scope; loadCases(); },
  'case-new': async () => {
    try { await caseMeta(); } catch (e) { toast(clean(e)); return; }
    S.cases.form = { Subject: '', Description: '', Priority: S.cases.meta.defPriority };
    renderCases(); $('#case-subject')?.focus();
  },
  'case-cancel': () => { S.cases.form = null; renderCases(); },
  'case-save': (el) => busy(el, 'Creating…', async () => {
    const f = S.cases.form;
    if (!f.Subject.trim()) throw new Error('Give the case a subject');
    const r = await api.sf('/sobjects/Case', { method: 'POST', body: JSON.stringify({ Subject: f.Subject.trim(), Description: f.Description, Priority: f.Priority || undefined }) });
    S.cases.form = null;
    toast('Case created in Salesforce');
    loadCases(); openCase(r.id);
  }),
  'case-take': (el) => busy(el, 'Assigning…', () => patchCase({ OwnerId: S.cfg.salesforce.user.id }, 'Case assigned to you')),
  'case-owner': (el) => busy(el, 'Assigning…', () => patchCase({ OwnerId: el.dataset.id }, `Case assigned to ${el.dataset.name}`)),
  'case-comment': (el) => busy(el, 'Posting…', async () => {
    const id = S.cases.detail.id, text = $('#case-comment').value.trim();
    if (!text) throw new Error('Write a comment first');
    await api.sf('/sobjects/CaseComment', { method: 'POST', body: JSON.stringify({ ParentId: id, CommentBody: text }) });
    S.cases.draft = '';
    toast('Comment posted to Salesforce');
    openCase(id);
  }),
  'case-from-mail': async () => {
    const m = selectedEmail();
    if (!m) return;
    let meta;
    try { meta = await caseMeta(); } catch (e) { toast(clean(e)); return; }
    const urgent = m.u?.level === 'urgent' && meta.priority.find((p) => /critical|urgent|high/i.test(p));
    S.cases.form = {
      Subject: m.subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, ''), fromMail: m.subject, Priority: urgent || meta.defPriority,
      Description: `From: ${m.from}\nReceived: ${m.date.toLocaleString()} in ${m.mailbox}\n${providerName(m.provider)}: ${m.webUrl}\n\n${S.ai[aiKey(m)]?.summary || m.snippet}`,
    };
    S.view = 'cases'; render();
    if (!S.cases.loaded) loadCases();
  },

  'cal-prev': async () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() - 1, 1); renderCalendar(); await loadEvents().catch((e) => toast(clean(e))); renderCalendar(); },
  'cal-next': async () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + 1, 1); renderCalendar(); await loadEvents().catch((e) => toast(clean(e))); renderCalendar(); },
  'cal-today': async () => { const t = new Date(); S.calMonth = new Date(t.getFullYear(), t.getMonth(), 1); S.calDay = key(t); renderCalendar(); await loadEvents().catch((e) => toast(clean(e))); renderCalendar(); },
  'hide-ev': (el, e) => { e.stopPropagation(); setHidden({ ids: [...S.hiddenEv.ids, el.dataset.id] }, 'Event hidden in Workmate Desk'); },
  'hide-series': (el, e) => { e.stopPropagation(); setHidden({ series: [...S.hiddenEv.series, el.dataset.series] }, 'Series hidden in Workmate Desk'); },
  'unhide-ev': (el, e) => {
    e.stopPropagation();
    setHidden({ ids: S.hiddenEv.ids.filter((x) => x !== el.dataset.id), series: S.hiddenEv.series.filter((x) => x !== el.dataset.series) }, 'Event shown again');
  },
  'show-hidden': () => { S.showHidden = !S.showHidden; renderCalendar(); },
  routine: () => { S.showRoutine = !S.showRoutine; store.set('showRoutine', S.showRoutine); S.calItem = null; renderCalendar(); },
  'cal-day': (el) => { S.calDay = el.dataset.day; S.calItem = null; renderCalendar(); },
  'cal-item': (el, e) => {
    e.stopPropagation();
    const cell = el.closest('.cell');
    if (cell) S.calDay = cell.dataset.day;
    const same = S.calItem?.id === el.dataset.id && S.calItem?.kind === el.dataset.kind;
    S.calItem = same && !cell ? null : { kind: el.dataset.kind, id: el.dataset.id };
    renderCalendar();
  },
};

document.addEventListener('toggle', (e) => { const d = e.target; if (d?.dataset?.fold) store.set('fold:' + d.dataset.fold, d.open); }, true);
document.addEventListener('click', (e) => {
  if (e.target.closest('summary') && e.target.closest('[data-action]')?.closest('summary')) e.preventDefault(); // a button in a fold header: don't fold
  if (S.boardMenu && !e.target.closest('.bpick')) { S.boardMenu = false; renderTasks(); } // click outside closes the board list
  const el = e.target.closest('[data-action]');
  // clicks on plain text inside an opened calendar item shouldn't collapse it; its buttons still work
  if (e.target.closest('.di-detail') && el?.classList.contains('day-item')) return;
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; renderList(); }
  if (e.target.id === 'comment') S.draft = e.target.value;
  if (e.target.id === 'edit-comment') S.editDraft = e.target.value;
  if (e.target.id === 'pic-dim') document.documentElement.style.setProperty('--dim', String(e.target.value / 100));
  if (e.target.id === 'link-q') { S.linkQ = e.target.value; $('#link-results').innerHTML = linkResults(); }
  if (e.target.id === 'task-q') { S.taskQ = e.target.value; renderBoard(); }
  if (e.target.id === 'board-q') { S.boardQ = e.target.value; $('#board-list').innerHTML = boardList(); }
  if (e.target.id === 'case-q') { S.cases.q = e.target.value; searchCasesSoon(); }
  if (e.target.id === 'owner-q') { S.cases.ownerQ = e.target.value; searchOwnersSoon(); }
  if (e.target.id === 'case-comment') S.cases.draft = e.target.value;
  if (e.target.dataset?.caseForm && S.cases.form) S.cases.form[e.target.dataset.caseForm] = e.target.value;
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'a-ws') { S.cfg = await api.asanaWorkspace(e.target.value); S.utl = null; }
  if (e.target.id === 'login') { S.ui = await api.openAtLogin(e.target.checked); }
  if (e.target.id === 'notify') store.set('notify', e.target.checked);
  if (e.target.id === 'acct-filter') { S.acctFilter = e.target.value; store.set('acctFilter', S.acctFilter); renderList(); }
  if (e.target.id === 'jira-transition' && e.target.value) {
    const gid = S.taskDetail.gid, id = e.target.value;
    transitionJira(gid, (x) => x.id === id).then((name) => { toast(`Moved to ${name}`); renderBoard(); openJira(gid); })
      .catch((err) => { toast(`Couldn't move it: ${clean(err)}`); renderTaskDetail(); });
  }
  if (e.target.dataset?.caseField) {
    const f = e.target.dataset.caseField, v = e.target.value;
    patchCase({ [f]: v }, `${f}: ${v}`).catch((err) => { toast(`Couldn't change it: ${clean(err)}`); renderCases(); });
  }
  if (e.target.dataset?.secProject) {
    const t = S.taskDetail.task, pg = e.target.dataset.secProject, sec = e.target.value;
    const m = t.memberships.find((x) => x.project?.gid === pg), before = m.section;
    m.section = (Array.isArray(S.sections[pg]) ? S.sections[pg] : []).find((x) => x.gid === sec) || { gid: sec };
    if (S.boardSrc === pg) moveTask(t.gid, sec); // same as dragging the card
    else api.asana(`/sections/${sec}/addTask`, { method: 'POST', body: JSON.stringify({ data: { task: t.gid } }) })
      .then(() => toast(`Moved to ${m.section.name}`))
      .catch((err) => { m.section = before; renderTaskDetail(); toast(`Couldn't move it: ${clean(err)}`); });
  }
  if (e.target.dataset?.cf) {
    const t = S.taskDetail.task, fg = e.target.dataset.cf, opt = e.target.value || null;
    const f = t.custom_fields.find((x) => x.gid === fg), before = f.enum_value;
    const setAll = (v) => boardCopies(t.gid).forEach((c) => {
      const cf = (c.custom_fields || []).find((x) => x.gid === fg);
      if (cf) cf.enum_value = v; else (c.custom_fields ||= []).push({ gid: fg, name: f.name, enum_value: v });
    });
    f.enum_value = opt ? f.enum_options.find((o) => o.gid === opt) : null;
    setAll(f.enum_value); renderBoard();
    api.asana(`/tasks/${t.gid}`, { method: 'PUT', body: JSON.stringify({ data: { custom_fields: { [fg]: opt } } }) })
      .then(() => toast(`${f.name}: ${f.enum_value?.name || 'None'}`))
      .catch((err) => { f.enum_value = before; setAll(before); renderBoard(); renderTaskDetail(); toast(`Couldn't change it: ${clean(err)}`); });
  }
  if (e.target.id === 'pic-dim') { S.ui = await api.setTheme({ dim: +e.target.value }); }
  if (e.target.id === 'file-pick') { addFiles(e.target.files); e.target.value = ''; }
  if (e.target.id === 'close-action') S.ui = await api.setCloseAction(e.target.value);
  if (e.target.id === 'mail-days' || e.target.id === 'mail-max') {
    S.mailDays = +$('#mail-days').value; S.mailMax = +$('#mail-max').value;
    store.set('mailDays', S.mailDays); store.set('mailMax', S.mailMax);
    S.emails = []; // start fresh with the new range on the next load
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'edit-comment' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('[data-action=edit-save]')?.click(); return; }
  if (e.target.id === 'edit-comment' && e.key === 'Escape') { S.editing = null; renderTaskDetail(); return; }
  if (e.key === 'Escape' && $('#lightbox')) { $('#lightbox').remove(); return; }
  if (e.key === 'Escape' && $('#close-dialog')) { $('#close-dialog').remove(); return; }
  if (e.key === 'Escape' && S.boardMenu) { S.boardMenu = false; renderTasks(); return; }
  if (e.target.id === 'board-q' && e.key === 'Enter') { $('#board-list .bm-row')?.click(); return; }
  if (e.target.id === 'comment' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('[data-action=post-comment]')?.click(); return; }
  if (e.target.id === 'case-comment' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('[data-action=case-comment]')?.click(); return; }
  if (S.view !== 'mail' || S.ui.widget || e.target.matches('input,select,textarea')) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const { list } = visibleEmails();
  const i = list.findIndex((m) => m.key === S.sel);
  const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (n) { e.preventDefault(); openMail(n.key); document.querySelector('.mail-item.sel')?.scrollIntoView({ block: 'nearest' }); }
});

// ---------- boot ----------
// background motion only while the window has focus; a parked widget costs no GPU
const still = () => document.body.classList.toggle('still', !document.hasFocus());
window.addEventListener('focus', still);
window.addEventListener('blur', still);
still();

(async () => {
  S.cfg = await api.config();
  S.ui = S.cfg.ui;
  S.links = await api.links();
  S.urg = await api.urgency();
  S.muted = await api.filters();
  S.mailDays = store.get('mailDays') ?? 14;
  S.mailMax = store.get('mailMax') ?? 100;
  S.showRoutine = store.get('showRoutine') ?? true;
  S.hiddenEv = store.get('hiddenEvents') || { ids: [], series: [] };
  S.defaultBoard = store.get('defaultBoard') || null;
  S.acctFilter = store.get('acctFilter') || '';
  if (!acctOf(S.acctFilter)) S.acctFilter = '';
  // urgent-mail notices recorded before multi-account used bare Gmail thread ids
  const seen = store.get('seenUrgent'), g = primaryGoogle();
  if (g && seen?.some((k) => !k.includes('|'))) store.set('seenUrgent', seen.map((k) => (k.includes('|') ? k : Sources.mailKey(g.id, k))));
  S.pic = await api.wallpaper();
  applyTheme();
  api.onUi((ui) => { S.ui = ui; render(); });
  api.onLinks((links) => { S.links = links; rescore(); refreshPanes(); });
  api.onTimerChanged(() => loadTimer().then(timerChanged).catch(() => {}));
  // the Command Palette dock asked to open a task (or just Workmate Desk)
  api.onOpenTask((gid) => { if (gid) actions['goto-task']({ dataset: { gid } }, noEvt); });
  S.view = S.cfg.accounts.length ? 'mail' : 'setup';
  render();
  if (S.cfg.accounts.length) loadAll();
  // refresh only while the window is visible; catch up when it comes back
  const due = () => S.cfg.accounts.length && S.view !== 'setup' && !document.hidden && Date.now() - S.lastLoad > 3 * 60 * 1000;
  setInterval(() => { if (due()) loadAll(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (due()) loadAll(); });
})();
