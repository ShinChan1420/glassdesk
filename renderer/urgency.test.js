const assert = require('assert');
const U = require('./urgency');

const now = new Date('2026-11-10T09:00:00');
const task = (gid, name, due_on, modified_at) => ({ gid, name, due_on, modified_at });

// keyword + important + linked task due today => urgent
let r = U.scoreEmail(
  { from: 'Ann <ann@acme.com>', subject: 'URGENT: invoice approval', snippet: '', labelIds: ['IMPORTANT', 'UNREAD'] },
  { linkedTasks: [task('1', 'Approve invoice', '2026-11-10')], now });
assert.strictEqual(r.level, 'urgent');
assert.ok(r.reasons.includes('Related task due today'));

// promo newsletter stays normal even with urgent wording in the snippet
r = U.scoreEmail({ from: 'noreply@shop.com', subject: 'Sale', snippet: 'act immediately', labelIds: ['CATEGORY_PROMOTIONS'] }, { now });
assert.strictEqual(r.level, 'normal');

// AI urgency feeds the score; meeting with sender adds context
r = U.scoreEmail({ from: 'Bo <bo@x.io>', subject: 'Contract', snippet: '', labelIds: ['UNREAD'] },
  { ai: { urgency: 'urgent' }, meetingSoonWith: new Set(['bo@x.io']), now });
assert.strictEqual(r.level, 'urgent');

// asana notification detection
assert.ok(U.isAsanaNotification('Asana <no-reply@mail.asana.com>'));
assert.ok(!U.isAsanaNotification('bob@notasana.co'));
assert.ok(U.isNotification('Everhour <noreply@everhour.com>'));
assert.ok(U.isNotification('Asana <no-reply@mail.asana.com>'));
assert.ok(!U.isNotification('Ann <ann@acme.com>'));

// local matching: task name in subject, or 2+ shared words, but not 1 shared word
const tasks = [task('a', 'Q4 budget review', null), task('b', 'Website redesign homepage', null), task('c', 'Budget', null)];
const m = U.matchTasks({ subject: 'Re: Q4 budget review notes', snippet: 'homepage looks good' }, tasks).map((t) => t.gid);
assert.deepStrictEqual(m, ['a']);

// noise filter
const linked = new Set(['x']);
assert.strictEqual(U.taskSignal(task('o', 'old', '2026-11-01'), linked, now).why, 'Overdue');
assert.strictEqual(U.taskSignal(task('x', 'l', null), linked, now).signal, true);
assert.strictEqual(U.taskSignal(task('n', 'n', null, '2026-10-01'), linked, now).signal, false);
assert.strictEqual(U.taskSignal(task('f', 'f', '2026-12-30'), linked, now).signal, false);

// manual override: email beats sender rule beats auto; no override keeps auto
const auto = { level: 'urgent', score: 7, reasons: ['Starred'] };
assert.strictEqual(U.applyOverride(auto, 'normal', 'urgent').level, 'normal');
assert.strictEqual(U.applyOverride(auto, '', 'high').manual, 'sender');
assert.strictEqual(U.applyOverride(auto, '', '').level, 'urgent');

console.log('urgency tests passed');
