// Pure normalizers that turn Gmail, Outlook and Jira data into the shapes the app already uses.
// Shared by the renderer (window.Sources) and the node test.
(function (root) {
  // Thread ids are only unique inside one mailbox, so every mail key carries its account.
  const mailKey = (acct, threadId) => `${acct}|${threadId}`;
  const addrOf = (from) => ((from.match(/<([^>]+)>/) || [, from])[1] || '').trim().toLowerCase();
  const nameOf = (from) => from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || addrOf(from);
  const header = (m, name) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  function email(a, f) {
    return { ...f, acct: a.id, provider: a.provider, mailbox: a.email, key: mailKey(a.id, f.threadId), fromAddr: addrOf(f.from), fromName: nameOf(f.from) };
  }

  function gmailEmail(a, m, decode = (s) => s) {
    return email(a, {
      id: m.id, threadId: m.threadId, from: header(m, 'From'), subject: header(m, 'Subject') || '(no subject)',
      date: new Date(+m.internalDate), snippet: decode(m.snippet), labelIds: m.labelIds || [],
      webUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(a.email)}#all/${m.threadId}`,
    });
  }

  const addrLine = (r) => (r?.emailAddress ? `${r.emailAddress.name ? `"${r.emailAddress.name}" ` : ''}<${r.emailAddress.address || ''}>` : '');

  // Outlook flags expressed as the Gmail labels the urgency scorer already understands
  function outlookLabels(m) {
    const l = [];
    if (!m.isRead) l.push('UNREAD');
    if (m.importance === 'high') l.push('IMPORTANT');
    if (m.flag?.flagStatus === 'flagged') l.push('STARRED');
    if (m.inferenceClassification === 'other') l.push('CATEGORY_PROMOTIONS'); // Focused Inbox "Other"
    return l;
  }

  function outlookEmail(a, m) {
    return email(a, {
      id: m.id, threadId: m.conversationId, from: addrLine(m.from), subject: m.subject || '(no subject)',
      date: new Date(m.receivedDateTime), snippet: m.bodyPreview || '', labelIds: outlookLabels(m), webUrl: m.webLink || 'https://outlook.office.com/mail/',
    });
  }

  // a Jira issue in the shape of an Asana task, so Focus, calendar, linking and the AI treat both alike
  function jiraTask(site, i) {
    const f = i.fields || {};
    return {
      gid: `jira:${i.key}`, key: i.key, source: 'jira', name: `${i.key} ${f.summary || ''}`.trim(),
      due_on: f.duedate || null, modified_at: f.updated || null, notes: '',
      projects: f.project ? [{ gid: `jira:${f.project.key}`, name: f.project.name }] : [],
      permalink_url: `${site}/browse/${i.key}`, status: f.status?.name || '', statusCat: f.status?.statusCategory?.key || '',
      assignee: f.assignee ? { name: f.assignee.displayName } : null,
    };
  }

  // Atlassian Document Format for a plain-text comment: one paragraph per non-empty line
  const adf = (text) => ({
    type: 'doc', version: 1,
    content: String(text).split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })),
  });

  // SOQL string literal escaping; LIKE also needs its wildcards escaped
  const soql = (s) => String(s).replace(/[\\']/g, (c) => '\\' + c).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  const soqlLike = (s) => soql(s).replace(/[%_]/g, (c) => '\\' + c);
  const sfId = (s) => /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(s || ''));

  const api = { mailKey, gmailEmail, outlookEmail, outlookLabels, addrLine, jiraTask, adf, soql, soqlLike, sfId };
  if (typeof module !== 'undefined') module.exports = api; else root.Sources = api;
})(this);
