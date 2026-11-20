# Workmate Desk

A Windows desktop app that puts Gmail and Outlook, Google Calendar, Asana, Jira and Salesforce Cases in one window. It flags urgent mail, suggests which Asana task or Jira issue an email belongs to, and hides tasks that don't need attention yet.

Each person signs in with their own accounts on the first screen, so anyone on a team can run it.

## Install

```bash
npm install
npm run install-app
```

This builds `dist\Workmate Desk Setup <version>.exe`, installs it for the current user (desktop shortcut, Start menu entry, uninstaller in Windows Settings → Apps), adds it to Windows start-up and starts it. Run the same command again to update. To give Workmate Desk to a colleague, send them the Setup exe: it's a normal installer wizard.

The app was called GlassDesk before. The installer removes the old copy and keeps its data (sign-ins, links, settings) in `%APPDATA%\glassdesk`.

To try it without installing:

```bash
npm start
```

## First-run setup

The first screen has step-by-step instructions with direct links for every service. They are summarised here.

### Mail accounts (at least one required)

Add as many Gmail and Outlook accounts as you like. They all land in one inbox, and the calendar comes from the first Gmail account. If you used Workmate Desk with one Gmail account before, that account moves into the list on first start, along with its links, urgency choices and saved AI reads. Settings lists every account with Reconnect and Disconnect buttons. An account whose sign-in has expired is marked in Settings and above its emails.

#### Gmail

You need an OAuth client ID of type *Desktop app*:

1. In Google Cloud Console, enable the Gmail API and the Google Calendar API.
2. Set up the OAuth consent screen. Pick *Internal* if everyone using the app is in your Workspace; that avoids Google's verification step for the Gmail scope.
3. Create an OAuth client ID (Desktop app) and paste the ID and secret into the app.

The whole team can share one client ID, and each person still signs in with their own Google account. Every extra Gmail account you add uses the same client ID. The app asks to read Gmail and change its labels, so opening an email can mark it read. It can't send or delete mail. Calendar access is read-only. If you connected before mark-as-read existed, the app asks you to reconnect Google once.

#### Outlook / Microsoft 365

You need an app registration in Microsoft Entra ID, made once per company:

1. In the Entra admin center, open App registrations → New registration. Pick *Accounts in this organizational directory only* and add a redirect URI of type *Public client/native (mobile & desktop)* with the value `http://localhost`.
2. Under API permissions, add the Microsoft Graph delegated permissions `Mail.ReadWrite`, `User.Read` and `offline_access`. An admin may need to grant consent.
3. Copy the Application (client) ID and the Directory (tenant) ID from Overview into the app, then sign in.

The app uses `Mail.ReadWrite` only to mark mail read. It can't send, move or delete mail, and it needs no client secret.

### Asana (optional)

Paste a personal access token from Asana → My apps, then pick a workspace.

### Jira (optional)

Jira Cloud only. Create an API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens), then enter your site (`your-company.atlassian.net`), your Atlassian email and the token. Comments and status changes you make show up in Jira under your name.

### Salesforce (optional)

A Salesforce admin creates an External Client App (a Connected App in older orgs) once. Turn OAuth on, set the callback URL to `http://localhost:47890/callback`, add the scopes *api* and *refresh_token, offline_access*, require PKCE, and turn off *Require secret* for both the web server flow and the refresh token flow. After that, each person pastes the app's consumer key and signs in through the browser. For a sandbox, change the login URL to `test.salesforce.com`, or use your My Domain address. A new app can take up to 10 minutes before sign-in works.

### Everhour (optional)

Paste the API key from the bottom of your Everhour profile page. Each task then gets a Start timer button and shows the time already logged. While a timer runs, it shows in the title bar and the widget, and you can stop it from there. Tasks only work with timers once their Asana project is connected in Everhour.

### AI assistant (optional)

The simplest option is "Use Claude Code": Workmate Desk runs the Claude Code CLI already signed in on your PC, so it uses the same account and counts toward the same usage. Workmate Desk never sees that sign-in. Every Claude Code tool is switched off for these calls, and your CLAUDE.md, hooks, plugins and MCP servers are skipped, so an email can only be read, never acted on. If you have more than one Claude Code installed, Workmate Desk uses the newest.

Under "Other ways to connect" you can instead sign in with a Claude Platform account (personal or your organisation's, through the `ant` CLI) or paste an API key from the Claude Console. Those bill as pay-as-you-go API usage.

Either way, the AI reads an email when you open it, plus up to 8 new unread emails per refresh. For each one it returns a one-line summary, an urgency level, and the open Asana tasks the email probably relates to, with a reason for each. Results are saved in `%APPDATA%\glassdeski-cache.json`, so an email is only read again when its thread gets a new message or you click "Analyse again". Saved results older than 90 days are dropped. Nothing gets linked until you click Link.

Tokens and keys are encrypted with Windows DPAPI and stored in `%APPDATA%\glassdesk\config.json`.

## What's in it

The Mail tab shows your inbox (the last 14 days and up to 100 emails by default). Red marks urgent mail and orange marks high priority. Unread mail is shown in bold, and the Unread tab lists only unread mail from senders you haven't muted. Copies of the same email (same sender and subject that Gmail filed as separate threads, which often happens with calendar updates) show as one row with a ×2 badge, and opening it marks every copy read. An open email shows the whole conversation, newest first: older messages are folded to one line, quoted history is hidden behind •••, and all pictures load, including ones embedded in signatures and picture attachments. The score combines Gmail's Important and Starred labels, urgent wording, due dates of related Asana tasks, a meeting with the sender in the next 24 hours, and the AI's read. You can override it: each email has an Auto / Urgent / High / Normal switch, and a second switch sets a standing rule for everything from that sender. A choice on one email beats the sender rule, and both beat the automatic score. Opening an email marks its conversation read in the mailbox that received it. With more than one account, every email shows which mailbox it came to, and a picker under the search box shows one account at a time. Mail from muted senders collapses into one "Muted" row. Asana and Everhour are muted by default; use "Mute sender" on any email, or edit the list under Settings → Mail. Settings → Mail also sets how far back to load (7 days to all time) and how many emails (50 to 500), and "Load 50 more" at the bottom of the inbox fetches older mail. The Focus column lists overdue tasks, tasks due within a week, tasks linked to an email and recently active ones; the rest sit behind "Show quiet tasks".

The Calendar tab is a month view with Google Calendar events in blue and every open Asana task or Jira issue that has a due date in orange (red once overdue). Click an event to see its guests, the Meet link, recent mail from those guests and related tasks. The side panel also says how many open tasks have no due date. "Hide routine" removes recurring events such as standups and 1:1s from the calendar, and the app remembers the setting. You can also hide a single event or a whole recurring series from the event's panel; "Hidden (N)" shows them again so you can unhide them. Hiding only affects Workmate Desk, never your Google Calendar. The widget's "Up next" card still shows them.

The Tasks tab shows your Asana boards with the sections you already set up. "My Tasks" uses your own My Tasks sections. The board picker lists every board you have an open task on, with your task count, busiest first, and has its own search. Your subtasks count toward their parent task's board and show there too. Click ☆ next to a board to make it your default: it opens first, and a "★ Default" button takes you back to it from any other board. Without a default, your busiest board opens first. When you open a task from the timer, widget, Focus, Calendar or a notification, Workmate Desk shows it on your default board if it's there, otherwise on another board it belongs to; My Tasks is always the last choice, used only for tasks that aren't on any board. Project boards show only tasks assigned to you, plus other people's tasks that block yours ("Blocks you") or wait on yours ("Waiting on you"). Those open in Asana on the web. Use the search box to filter cards by task or project name. Drag a card to another column to move the task to that section in Asana (other people's cards can't be moved). Click a card to change its status (mark it complete, move it to another section on each board it's on, or set dropdown fields such as Status or Priority; a Status value also shows as a coloured badge on the card), read the description, what it's blocked by and what it's blocking (these links open on the web), its comments and related mail, and to post a comment. Your own comments have an Edit button. A task's pictures show as thumbnails under its description (click for full size), and other files open in Asana. Pictures are cached on this PC for speed, and a task's cache is deleted once you haven't opened that task for 14 days. To attach files to a comment, paste a screenshot, drop files on the comment box, or click Attach; they upload to the task when you post (25 MB per file). To link a task to an email, type part of its name in the search box under "Linked tasks". Comments go to Asana under your name, since the app uses your personal access token.

With Jira connected, the board picker also has "Jira: my issues": every open issue assigned to you, one column per status. Drag a card to another column to move the issue there, as long as Jira's workflow allows that move. Click an issue to read its description and comments, change its status or add a comment. Jira issues also show in Focus, on the calendar when they have a due date, in the "link a task" search and in the AI's suggestions. An email that mentions an issue key such as OPS-12 is matched to that issue.

With Salesforce connected, a Cases tab lists your open cases. You can switch to all open cases or all cases, or search by subject or case number. Click a case to change its status or priority, assign it to yourself or someone else, read its description and comments, and add an internal comment. New case starts a blank case, and "Create Salesforce case" on an email opens the form already filled in from that email.

Settings → Appearance changes the background: Aurora (moving colour), Morandi (dusty, muted tones), Mist, Graphite, Transparent (Windows 11 frosted glass showing your desktop) or your own picture with a dim slider, plus System / Light / Dark mode. Drag the edge of the side panels to resize them; double-click the edge to reset. Workmate Desk sends a Windows notification when a task is newly assigned to you or an urgent unread email arrives (turn it off in Settings). The pin button keeps the window above other windows. Closing the full window asks whether to turn it into the widget or quit (tick "Don't ask again" to skip the question; change it later under Settings → "When I close the window"). Closing the widget takes you back to the full window. Clicking the running Everhour timer opens its task on your default board.

The widget button shrinks the app to a small card in the top-right corner with any running timer, your meetings for the next 24 hours, mail that needs attention and tasks due soon. Nothing is cut off: a list longer than 5 shows 5 rows and scrolls, with a "N more" hint, and "More below" appears when cards continue past the bottom edge. The widget can't be made smaller than the size that keeps every button visible. Drag it anywhere and it remembers the spot. Turn on "Open at Windows sign-in" in Settings and it will be on your desktop every morning.

## Working with Claude Code

Workmate Desk and Claude Code can use each other.

- **Work on this in Claude Code.** Every task has this button. Workmate Desk writes the task's description, comments, blockers, linked emails and logged time to `Documents\Workmate Desk\<task name>\TASK.md` and opens Claude Code in a new terminal in that folder, ready to help. Anything Claude Code writes for the task lands in the same folder.
- **Workmate Desk as a Claude Code tool.** Settings → Claude Code connection → Connect adds Workmate Desk to every Claude Code session on this PC (terminal or desktop app). Claude Code can then see your day, search tasks and email, read a task's full context or an email thread, and check your calendar. With your OK each time, it can also link an email to a task, comment on a task, or start and stop an Everhour timer. The connection is local: Workmate Desk serves it on `127.0.0.1` with a private key, and it only works while Workmate Desk is running. Email content is marked as untrusted, so Claude Code treats it as data, not instructions. Disconnect removes it from Claude Code again.

## Everhour on the Command Palette dock

If PowerToys Command Palette is installed, `npm run install-app` also builds and installs a small Command Palette extension (`cmdpal-dock`, needs Visual Studio and Windows Developer Mode). It adds an **Everhour timer** band to the Command Palette Dock showing how long you've tracked today on the running task, next to the task name. Workmate Desk checks Everhour's running timer every 15 seconds and shares it with the app, the widget and the dock, so a timer started or stopped anywhere (Everhour's own web app or browser extension, the dock, Claude Code) shows up everywhere within about 15 seconds, and straight away for changes made in Workmate Desk or the dock. Click it for a panel laid out like Everhour's Time view: the running task with Stop, this week's and today's totals, and for each day a total row followed by every task's time that day and its project. Select an entry to start the timer on that task again (Ctrl+K on it opens the task in Workmate Desk), or type to filter. The same commands are in the palette as "Everhour timer" and "Stop Everhour timer".

To show it: in Command Palette run **Reload** once, then open Command Palette settings → Dock → Bands and pin **Everhour timer**. The band talks to Workmate Desk on this PC, so Workmate Desk needs to be running.

## Limits

- Links between emails and tasks are saved on this PC only. They aren't written to Asana or Jira.
- The calendar comes from the first Gmail account. Outlook calendars aren't shown.
- "Load 50 more" fetches 50 more from every account that still has older mail.
- Up to 500 open Jira issues assigned to you are loaded.
- Jira comments are plain text. You can't attach files to Jira issues or Salesforce cases from Workmate Desk.
- Claude Code's email search covers the first Gmail account. Reading and linking emails work for every account.
- Up to 2,000 open tasks per board are loaded. The AI sees the 150 with the nearest due dates.
- The app skips refreshes while minimised and catches up when you bring it back. It still runs on Electron (a bundled Chromium), so it uses more memory than a native Windows app would.
- The see-through window background needs Windows 11. On Windows 10 the app works without the blur behind the window.

## Tests

```bash
npm test
```

Covers the urgency score, the local task matcher, the Asana noise filter, how Gmail, Outlook and Jira data is read, and SOQL escaping. `services.test.js` runs against a mocked network and covers the move to multiple accounts, per-account sign-ins, URL checks, and the Jira and Salesforce clients.

GitHub Actions runs the tests and builds the Windows installer on pushes and pull requests to `main`. The installer is available as a `windows-installer` workflow artifact.
