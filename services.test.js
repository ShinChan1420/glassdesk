// Mocked-API checks for services.js: account migration, per-account tokens, URL guards, Jira and Salesforce clients.
const assert = require('assert');
const { create, migrate } = require('./services');

const enc = (s) => `E(${s})`;
const dec = (s) => (s ? s.replace(/^E\((.*)\)$/, '$1') : '');
// like fetch: an empty body (204) makes .json() reject
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new SyntaxError('Unexpected end of JSON input'); return body; } });

let calls = [];
let route = () => res(404, {});
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
  calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization, body });
  return route(u, body);
};

(async () => {
  // ---------- migration from the single-Gmail config ----------
  const legacy = {
    google: { clientId: 'cid.apps.googleusercontent.com', secret: 'E(s)', refresh: 'E(r1)', email: 'Ann@Acme.com', scope: 'gmail.modify' },
    links: { t1: ['111'], 'google:x@y.z|t2': ['222'] }, urgency: { threads: { t1: 'urgent' }, senders: { 'a@b.c': 'high' } },
  };
  const ai = { 't1:m1': { at: 1, result: {} } };
  assert.strictEqual(migrate(legacy, ai), true);
  assert.deepStrictEqual(legacy.accounts, [{ id: 'google:ann@acme.com', provider: 'google', email: 'Ann@Acme.com', refresh: 'E(r1)', scope: 'gmail.modify' }]);
  assert.deepStrictEqual(legacy.google, { clientId: 'cid.apps.googleusercontent.com', secret: 'E(s)' });
  assert.deepStrictEqual(Object.keys(legacy.links), ['google:ann@acme.com|t1', 'google:x@y.z|t2']);
  assert.deepStrictEqual(legacy.urgency, { threads: { 'google:ann@acme.com|t1': 'urgent' }, senders: { 'a@b.c': 'high' } });
  assert.deepStrictEqual(Object.keys(ai), ['google:ann@acme.com|t1:m1']);
  assert.strictEqual(migrate(legacy, ai), false); // runs once
  const blank = { google: {} };
  assert.strictEqual(migrate(blank), true);
  assert.deepStrictEqual(blank.accounts, []);

  // ---------- mail accounts: each request uses its own account's token ----------
  let saved = 0;
  const cfg = {
    google: { clientId: 'cid', secret: 'E(gs)' }, microsoft: { clientId: 'mid', tenant: 'acme.com' },
    accounts: [
      { id: 'google:a@acme.com', provider: 'google', email: 'a@acme.com', refresh: 'E(ga)' },
      { id: 'google:a@home.org', provider: 'google', email: 'a@home.org', refresh: 'E(gb)' },
      { id: 'microsoft:a@acme.com', provider: 'microsoft', email: 'a@acme.com', refresh: 'E(m1)' },
    ],
  };
  const svc = create({ getCfg: () => cfg, saveCfg: () => { saved++; }, enc, dec, open: () => {} });
  route = (u, body) => {
    if (u === 'https://oauth2.googleapis.com/token') return res(200, { access_token: `tok-${body.refresh_token}`, expires_in: 3600 });
    if (u === 'https://login.microsoftonline.com/acme.com/oauth2/v2.0/token') return res(200, { access_token: `tok-${body.refresh_token}`, refresh_token: 'm2', expires_in: 3600 });
    return res(200, { ok: true });
  };
  await svc.mailFetch('google:a@acme.com', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/t1');
  await svc.mailFetch('google:a@home.org', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/t1');
  await svc.mailFetch('microsoft:a@acme.com', 'https://graph.microsoft.com/v1.0/me/messages');
  const api = calls.filter((c) => !c.url.includes('token'));
  assert.deepStrictEqual(api.map((c) => c.auth), ['Bearer tok-ga', 'Bearer tok-gb', 'Bearer tok-m1']);
  assert.strictEqual(calls.find((c) => c.url.includes('microsoftonline')).body.client_id, 'mid');
  assert.strictEqual(cfg.accounts[2].refresh, 'E(m2)', 'Microsoft rotates refresh tokens: keep the new one');
  assert.ok(saved > 0);

  // the cached token is reused; a 401 refreshes once and retries
  calls = [];
  await svc.mailFetch('google:a@acme.com', 'https://gmail.googleapis.com/gmail/v1/users/me/labels');
  assert.strictEqual(calls.length, 1);
  calls = [];
  let first = true;
  route = (u, body) => {
    if (u.includes('oauth2.googleapis.com')) return res(200, { access_token: 'fresh', expires_in: 3600 });
    if (first) { first = false; return res(401, {}); }
    return res(200, { ok: true });
  };
  assert.deepStrictEqual(await svc.mailFetch('google:a@acme.com', 'https://gmail.googleapis.com/gmail/v1/users/me/labels'), { ok: true });
  assert.deepStrictEqual(calls.map((c) => c.auth || 'token'), ['Bearer tok-ga', 'token', 'Bearer fresh']);

  // an account can only reach its own provider's API
  await assert.rejects(svc.mailFetch('google:a@acme.com', 'https://graph.microsoft.com/v1.0/me/messages'), /Blocked/);
  await assert.rejects(svc.mailFetch('microsoft:a@acme.com', 'https://gmail.googleapis.com/gmail/v1/users/me/threads'), /Blocked/);
  await assert.rejects(svc.mailFetch('google:a@acme.com', 'http://gmail.googleapis.com/x'), /Blocked/);
  await assert.rejects(svc.mailFetch('google:a@acme.com', 'https://gmail.googleapis.com.evil.io/x'), /Blocked/);
  await assert.rejects(svc.mailFetch('google:gone@x.io', 'https://gmail.googleapis.com/x'), /no longer connected/);

  // a revoked sign-in marks the account for reconnecting
  route = () => res(400, { error: 'invalid_grant' });
  await assert.rejects(svc.mailFetch('google:a@home.org', 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {}, true), /reconnect/);
  assert.strictEqual(cfg.accounts[1].needsReconnect, true);
  svc.removeAccount('google:a@home.org');
  assert.deepStrictEqual(cfg.accounts.map((a) => a.id), ['google:a@acme.com', 'microsoft:a@acme.com']);

  // ---------- Jira ----------
  cfg.jira = { site: 'https://acme.atlassian.net', email: 'a@acme.com', token: 'E(jt)' };
  calls = [];
  route = () => res(200, { issues: [] });
  await svc.jiraFetch('/search/jql', { method: 'POST', body: '{}' });
  assert.strictEqual(calls[0].url, 'https://acme.atlassian.net/rest/api/3/search/jql');
  assert.strictEqual(calls[0].auth, 'Basic ' + Buffer.from('a@acme.com:jt').toString('base64'));
  await assert.rejects(svc.jiraFetch('/../../admin'), /Bad Jira path/);
  await assert.rejects(svc.jiraFetch('https://evil.io/x'), /Bad Jira path/);
  route = () => res(400, { errorMessages: [], errors: { summary: 'Summary is required' } });
  await assert.rejects(svc.jiraFetch('/issue'), /Summary is required/);
  await assert.rejects(svc.connectJira('https://evil.io', 'a@b.c', 't'), /atlassian\.net/);
  route = () => res(200, { accountId: 'acc1', displayName: 'Ann' });
  await svc.connectJira('acme', 'a@acme.com', 'tok2'); // bare site name
  assert.deepStrictEqual(cfg.jira, { site: 'https://acme.atlassian.net', email: 'a@acme.com', token: 'E(tok2)', user: { accountId: 'acc1', name: 'Ann' } });

  // ---------- Salesforce ----------
  cfg.salesforce = { clientId: 'ck', loginUrl: 'https://login.salesforce.com', refresh: 'E(sr)', instanceUrl: 'https://acme.my.salesforce.com' };
  calls = [];
  route = (u, body) => {
    if (u.endsWith('/services/oauth2/token')) return res(200, { access_token: 'sf1', instance_url: 'https://acme2.my.salesforce.com' });
    return res(200, { records: [{ Id: '500000000000001' }] });
  };
  const q = await svc.sfFetch('/query?q=SELECT+Id+FROM+Case');
  assert.strictEqual(q.records.length, 1);
  assert.deepStrictEqual(calls[0].body, { grant_type: 'refresh_token', refresh_token: 'sr', client_id: 'ck' });
  assert.strictEqual(calls[1].url, 'https://acme2.my.salesforce.com/services/data/v62.0/query?q=SELECT+Id+FROM+Case');
  assert.strictEqual(calls[1].auth, 'Bearer sf1');
  // a token reply naming a non-Salesforce host doesn't move where requests go
  calls = [];
  route = (u) => (u.endsWith('/services/oauth2/token') ? res(200, { access_token: 'sf2', instance_url: 'https://evil.io' }) : calls.length < 3 ? res(401, [{ message: 'Session expired' }]) : res(204));
  assert.deepStrictEqual(await svc.sfFetch('/sobjects/Case/500000000000001', { method: 'PATCH', body: '{}' }), {});
  assert.ok(calls.every((c) => !c.url.startsWith('https://evil.io')));
  assert.strictEqual(cfg.salesforce.instanceUrl, 'https://acme2.my.salesforce.com');
  route = () => res(400, [{ message: 'Status: bad value for restricted picklist field', errorCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST' }]);
  await assert.rejects(svc.sfFetch('/sobjects/Case/500000000000001', { method: 'PATCH', body: '{}' }), /restricted picklist/);
  await assert.rejects(svc.sfFetch('/../../services/oauth2/revoke'), /Bad Salesforce path/);
  await assert.rejects(svc.connectSalesforce('ck', 'https://login.evil.io'), /Login URL/);
  svc.disconnectSalesforce();
  assert.deepStrictEqual(cfg.salesforce, { clientId: 'ck', loginUrl: 'https://login.salesforce.com' });
  await assert.rejects(svc.sfFetch('/query?q=x'), /not connected/);

  console.log('services tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
