const assert = require('assert');
const S = require('./sources');
const U = require('./urgency');

const gmailA = { id: 'google:ann@acme.com', provider: 'google', email: 'ann@acme.com' };
const gmailB = { id: 'google:ann@home.org', provider: 'google', email: 'ann@home.org' };
const outlook = { id: 'microsoft:ann@acme.onmicrosoft.com', provider: 'microsoft', email: 'ann@acme.onmicrosoft.com' };

// the same Gmail thread id in two mailboxes stays two emails
const raw = { id: 'm1', threadId: 't1', internalDate: '1700000000000', snippet: 'Hi &amp; bye', labelIds: ['UNREAD'],
  payload: { headers: [{ name: 'From', value: 'Bo Li <BO@x.io>' }, { name: 'Subject', value: 'Budget' }] } };
const a = S.gmailEmail(gmailA, raw, (s) => s.replace('&amp;', '&'));
const b = S.gmailEmail(gmailB, raw);
assert.notStrictEqual(a.key, b.key);
assert.strictEqual(a.key, 'google:ann@acme.com|t1');
assert.strictEqual(a.acct, gmailA.id);
assert.strictEqual(a.fromAddr, 'bo@x.io');
assert.strictEqual(a.fromName, 'Bo Li');
assert.strictEqual(a.snippet, 'Hi & bye');
assert.ok(a.webUrl.includes('authuser=ann%40acme.com') && a.webUrl.endsWith('#all/t1'));

// Outlook: conversation id is the thread, flags become the labels the scorer knows
const o = S.outlookEmail(outlook, {
  id: 'AAMk1', conversationId: 'AAQk9', subject: 'URGENT: invoice', receivedDateTime: '2026-11-10T08:00:00Z', bodyPreview: 'pay today',
  from: { emailAddress: { name: 'Cy', address: 'Cy@Vendor.com' } }, isRead: false, importance: 'high', flag: { flagStatus: 'flagged' },
  inferenceClassification: 'focused', webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk1',
});
assert.strictEqual(o.key, `${outlook.id}|AAQk9`);
assert.strictEqual(o.provider, 'microsoft');
assert.strictEqual(o.mailbox, outlook.email);
assert.strictEqual(o.fromAddr, 'cy@vendor.com');
assert.strictEqual(o.fromName, 'Cy');
assert.deepStrictEqual(o.labelIds, ['UNREAD', 'IMPORTANT', 'STARRED']);
assert.strictEqual(U.scoreEmail(o, { now: new Date('2026-11-10T09:00:00Z') }).level, 'urgent');
assert.deepStrictEqual(S.outlookLabels({ isRead: true, inferenceClassification: 'other' }), ['CATEGORY_PROMOTIONS']);
// no sender (drafts, some system mail) doesn't break parsing
assert.strictEqual(S.outlookEmail(outlook, { id: 'x', conversationId: 'c', receivedDateTime: '2026-11-10T08:00:00Z', isRead: true }).fromAddr, '');

// Jira issue in task shape: urgency and calendar read due_on like an Asana task
const j = S.jiraTask('https://acme.atlassian.net', {
  key: 'OPS-12', fields: { summary: 'Fix login', duedate: '2026-11-10', updated: '2026-11-09T10:00:00.000+0000',
    project: { key: 'OPS', name: 'Operations' }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Ann' } },
});
assert.strictEqual(j.gid, 'jira:OPS-12');
assert.strictEqual(j.name, 'OPS-12 Fix login');
assert.strictEqual(j.permalink_url, 'https://acme.atlassian.net/browse/OPS-12');
assert.deepStrictEqual(j.projects, [{ gid: 'jira:OPS', name: 'Operations' }]);
assert.strictEqual(j.statusCat, 'indeterminate');
assert.strictEqual(U.taskSignal(j, new Set(), new Date('2026-11-10T09:00:00')).why, 'Due today');
assert.strictEqual(U.matchTasks({ subject: 'Re: [OPS-12] portal', snippet: '' }, [j]).length, 1);
assert.strictEqual(U.matchTasks({ subject: 'Re: OPS-123 portal', snippet: '' }, [j]).length, 0);

// ADF comment: one paragraph per non-empty line
assert.deepStrictEqual(S.adf('one\n\n two\r\n').content.map((p) => p.content[0].text), ['one', ' two']);

// SOQL literals can't be broken out of; LIKE wildcards are literal
assert.strictEqual(S.soql("O'Brien\\"), "O\\'Brien\\\\");
assert.strictEqual(S.soql("x' OR Name LIKE '%"), "x\\' OR Name LIKE \\'%");
assert.strictEqual(S.soqlLike('50%_off'), '50\\%\\_off');
assert.ok(S.sfId('500Hs00001XyZab') && S.sfId('500Hs00001XyZabAAA'));
assert.ok(!S.sfId("500' OR Id != '") && !S.sfId('500Hs00001XyZa') && !S.sfId(''));

console.log('sources tests passed');
