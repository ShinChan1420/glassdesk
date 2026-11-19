// Pure scoring helpers, shared by the renderer (window.Urgency) and the node test.
(function (root) {
  const DAY = 86400000;
  const STOP = new Set('the and for with from that this your you are was have has will re fwd fw about into please thanks regarding update meeting today'.split(' '));
  const KEYWORDS = /\b(urgent|asap|immediately|critical|action required|deadline|eod|end of day|overdue|outage|down|escalat\w*|blocker|blocking|time[- ]sensitive)\b/i;

  const tokens = (s) => new Set((s || '').toLowerCase().replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/i, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));

  const isAsanaNotification = (from) => /@([\w-]+\.)*asana\.com\b/i.test(from || '');
  // automated tool mail that should never sit in the inbox: Asana and Everhour notifications
  const isNotification = (from) => /@([\w-]+\.)*(asana|everhour)\.com\b/i.test(from || '');

  const dueDate = (t) => (t.due_at ? new Date(t.due_at) : t.due_on ? new Date(t.due_on + 'T23:59:59') : null);
  const daysUntil = (t, now) => { const d = dueDate(t); return d ? Math.floor((d - now) / DAY) : null; };

  // Cheap local guess at related tasks, used before / without the AI agent.
  function matchTasks(email, tasks) {
    const subj = (email.subject || '').toLowerCase();
    const et = tokens(email.subject + ' ' + (email.snippet || ''));
    return tasks.filter((t) => {
      const name = (t.name || '').toLowerCase();
      if (name.includes(' ') && name.length >= 8 && subj.includes(name)) return true;
      let shared = 0;
      for (const w of tokens(t.name)) if (et.has(w)) shared++;
      return shared >= 2;
    });
  }

  // ctx: { linkedTasks, meetingSoonWith:Set<email>, ai:{urgency}, now }
  function scoreEmail(email, ctx = {}) {
    const now = ctx.now || new Date();
    const labels = email.labelIds || [];
    const reasons = [];
    let score = 0;
    const add = (n, why) => { score += n; if (why) reasons.push(why); };

    if (isNotification(email.from)) add(-2, null);
    if (labels.includes('IMPORTANT')) add(2, 'Marked important');
    if (labels.includes('STARRED')) add(2, 'Starred');
    if (labels.includes('UNREAD')) add(1, null);
    if (labels.some((l) => /CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)/.test(l)) || /no-?reply/i.test(email.from)) add(-3, null);
    if (KEYWORDS.test(email.subject)) add(3, 'Urgent wording');
    else if (KEYWORDS.test(email.snippet)) add(1, 'Urgent wording');

    let soonest = null;
    for (const t of ctx.linkedTasks || []) {
      const d = daysUntil(t, now);
      if (d !== null && (soonest === null || d < soonest)) soonest = d;
    }
    if (soonest !== null) {
      if (soonest < 0) add(4, 'Related task overdue');
      else if (soonest === 0) add(4, 'Related task due today');
      else if (soonest <= 1) add(3, 'Related task due tomorrow');
      else if (soonest <= 3) add(2, `Related task due in ${soonest} days`);
    }

    const addr = ((email.from || '').match(/<([^>]+)>/) || [, email.from])[1]?.toLowerCase();
    if (addr && ctx.meetingSoonWith?.has(addr)) add(1, 'Meeting with sender soon');

    const ai = ctx.ai?.urgency;
    if (ai === 'urgent') add(3, 'AI: urgent');
    else if (ai === 'high') add(1, 'AI: high priority');
    else if (ai === 'low') add(-2, null);

    const level = score >= 5 ? 'urgent' : score >= 3 ? 'high' : 'normal';
    return { score, level, reasons };
  }

  // Asana noise filter: keep tasks that need attention now, hide the rest.
  function taskSignal(task, linkedGids, now = new Date()) {
    const d = daysUntil(task, now);
    if (d !== null && d < 0) return { signal: true, why: 'Overdue', rank: 0 };
    if (d !== null && d <= 1) return { signal: true, why: d === 0 ? 'Due today' : 'Due tomorrow', rank: 1 };
    if (linkedGids.has(task.gid)) return { signal: true, why: 'Linked to email', rank: 2 };
    if (d !== null && d <= 7) return { signal: true, why: `Due in ${d} days`, rank: 3 };
    if (task.modified_at && now - new Date(task.modified_at) < 2 * DAY) return { signal: true, why: 'Recently active', rank: 4 };
    return { signal: false, why: d === null ? 'No due date' : `Due in ${d} days`, rank: 9 };
  }

  // Manual choice always wins: one email beats a sender rule, both beat the automatic score.
  const MANUAL_SCORE = { urgent: 100, high: 50, normal: -100 };
  function applyOverride(u, threadLevel, senderLevel) {
    const level = threadLevel || senderLevel;
    if (!level) return { ...u, manual: '' };
    return { level, score: MANUAL_SCORE[level], reasons: [threadLevel ? 'Set by you' : 'Your rule for this sender'], manual: threadLevel ? 'thread' : 'sender', auto: u };
  }

  const api = { tokens, matchTasks, scoreEmail, taskSignal, isAsanaNotification, isNotification, dueDate, daysUntil, applyOverride };
  if (typeof module !== 'undefined') module.exports = api; else root.Urgency = api;
})(this);
