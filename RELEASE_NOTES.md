# Release notes

Newest release first. Each release lists what changed, how to install or update, and what is known not to work yet.

## 0.3.0 (2026-11-19)

A P1 alarm, keyboard actions, a query language, shareable links, lanes, response times, maintenance windows and Operations widgets. Everything stays within Jira Service Management Operations.

### Update from 0.2

```bash
git pull
npm ci
```

Restart the application. Preferences saved in the browser are kept. To create and end maintenance windows, add `maintenance` to `JIRA_WRITE_ACTIONS` (or keep `true`).

### New

- **P1 alarm:** the bell in the top bar plays a tone and shows a desktop notification when a P1 alert arrives (new, raised to P1, or back from snooze). Other priorities never alarm. Settings → P1 alarm has separate switches and a test button.
- **Keys** for the open alert: A acknowledge, U unacknowledge, C close (confirm with C or Enter, Esc cancels), W watch, O open in Jira, N note.
- **Watch list:** a star marks alerts you follow; the "Watching" quick filter lists them.
- **Links and runbooks:** web addresses in descriptions, notes and properties are clickable, and a runbook link gets its own button.
- **Custom actions:** run the actions an integration defines on an alert, after confirmation.
- **Search queries:** for example `priority:P1 AND customer:Contoso`, `created<2h` or `NOT tag:test`. Plain words still work as before.
- **Copy link:** the address now carries filters, search, quick filter and sorting, so a view can be shared.
- **Lanes:** split the table by customer, service or team; works together with Group repeats.
- **24-hour strip** for repeated alerts, in the table and in History → Recurring.
- **History → Response:** MTTA and MTTR (median and 90th percentile) by priority, customer or alert group.
- **Maintenance windows:** a widget that lists them and can create and end them (write action `maintenance`), a top-bar indicator while one is active, and a badge on covered alerts.
- **Heartbeats** and **On call now** widgets.
- **`CUSTOMER_MAP_FILE`:** customers from an entity mapping file, in addition to tags and properties.
- **`/healthz` and `/readyz`** for process or container probes.
- **End-to-end tests:** `npm run e2e` (demo mode, 13 browser tests) and `npm run e2e:live` (round trip with a Jira test site). The first time on a computer, run `npx playwright install chromium`.
- **Simulator:** `npm run jira:simulate -- run --yes` plays a realistic 12-minute scenario on a Jira test site (outage, repeats, flapping alert, expiring heartbeat, acknowledge and resolve); `cleanup --yes` undoes it.

### Changed

- When Jira refuses a write, its reason is now shown (shortened, never logged).
- Code quality: all 365 SonarQube code smells resolved without changing behaviour or appearance (27 functions split below the complexity threshold, read-only props, no nested ternaries, semantic elements where they are drop-in). Behaviour was checked against the old code side by side, with 36 new unit tests, and by screenshot and layout comparisons.
- A crash in "New maintenance" when "Start later" was ticked and the start time cleared while confirming.
- SonarQube findings fixed: table rows handle their keys themselves, regular expressions that could backtrack on long input replaced with loops, cryptographic random numbers and SHA-256 where Math.random and SHA-1 were used, a missing sort comparison and a missing `reduce` start value. The demo data is unchanged.
- Closed alerts get their extra properties too (up to ten per run, after the open ones), so their service and customers no longer fall back to the entity. Known properties stay visible while an alert changes.
- In demo mode, acknowledging sets the owner and unacknowledging clears it, as Jira does.
- The demo data has runbook links and custom actions on some alerts.

### Tested

- 189 unit tests.
- `npm run e2e`: 13 browser tests in demo mode, no console errors.
- SonarQube (Community Build 26.6): 0 bugs, 0 vulnerabilities, 0 code smells, 0 open security hotspots, A ratings for security, reliability and maintainability, 0% duplication. 22 findings are accepted in Sonar with a reason (mostly the table's deliberate ARIA grid). The gate's new-code coverage condition is at 43.7% of 50%: the interface is tested by the browser tests, which Sonar does not measure.
- `npm run e2e:live` against the trial site (Premium trial): 4 round-trip tests pass, including a custom action ("Executed action: Run diagnostics").
- The simulator ran on the trial site; the heartbeat expired and Jira raised its alert, which the Heartbeats widget and the table show.
- Also on the trial site: Escalate to next, team, schedule and escalation responders, and creating and ending a maintenance window.

### Not tested yet

- Heartbeats with real data, and creating a team maintenance window.
- "Open in Jira" in a browser signed in to Jira.
- Windows and macOS.

### Known limits

- On-call users and user, schedule and escalation responders are shown by id in live mode; the Operations API returns no names.
- Maintenance coverage of alerts is matched by integration name; policy and sync rules cannot be matched to alerts.
- The 24-hour strip shows only each alert's last re-occurrence; Jira keeps no record of earlier ones.

## 0.2.0 (2026-11-19)

Write actions on alerts (off by default), bulk actions, repeated-alert grouping, History analytics, a customer scope, and settings backup. First run against a real Jira site.

### Update from 0.1.0

```bash
git pull
npm ci
```

Restart `npm run dev`. Preferences saved in the browser are kept. Nothing changes in Jira until you enable actions.

### Turn on write actions

Add one line to `.env` and restart:

```
JIRA_WRITE_ACTIONS=true
```

Or allow only some actions, for example `JIRA_WRITE_ACTIONS=acknowledge,unacknowledge,addNote`. Actions are done as the account in `JIRA_EMAIL`. Try them on a test site first: `npm run jira:test-alerts -- create --yes` fills an empty site with sample alerts, and `close --yes` closes them again.

### New

- **Actions in the detail panel:** acknowledge, unacknowledge, close (with confirmation), snooze, assign (to me or by name), add responder, escalate to next, change priority, add and remove tags, add notes. Each shows Jira's outcome next to the buttons.
- **Bulk actions:** tick rows (Shift+click for a range, X on the keyboard) to acknowledge, unacknowledge or close many alerts. The count is confirmed first, and the result is reported per alert.
- **Notes, activity log and attachments** in the detail panel. These work without enabling actions.
- **Group repeats:** a toggle next to Views collapses repeated alerts into one expandable row with distinct records and total occurrences.
- **History analytics:** Recurring alerts, P1 hotspots and Alerts per customer next to the monthly histogram, with drill-down and saved investigations.
- **Customer scope:** a chip in the top bar limits KPIs, widgets, counts and the table to chosen customers, without changing saved views.
- **Backup:** Settings → Backup exports and imports preferences, or a single saved view, with a preview and a choice for conflicting views.

### Changed

- After a rate-limit answer (429), the backend now pauses every Jira request briefly, not only the refused one, and loads alert details two at a time. Action results keep being checked through a 429 instead of ending as "pending".
- Attachments are read with the field names the live API uses (`name`, `createdAt`) as well as the documented ones.
- Settings → Connection shows which actions are enabled.
- History: the "Analyze by month" button is now "Analyze", with four breakdowns.

### Tested

- 91 unit tests (`npm test`): every action against a fake API, request validation, and refusal of cross-site, wrong-type and disabled requests.
- 23 checks in a headless browser in demo mode, covering every action, bulk, grouping and keyboard selection, with no console errors. The History and backup features had their own 18 and 28 browser checks.
- Against a Jira Service Management trial site (Free, then a Premium trial), through the application and its API: listing, sync, notes, activity log, user search, attachments, and acknowledge, unacknowledge, close, snooze, assign, note, priority, tags, add responder, bulk acknowledge and unacknowledge, and create alert. Details are in the README under "Verified on a live site".

### Not tested yet

- Escalate to next and team responders on a real site (done in 0.3.0).
- The Standard plan: Free refuses assign and snooze, Premium allows them; Standard was not tried.
- "Open in Jira" in a browser signed in to Jira.
- Windows and macOS.

### Known limits

- Every action is done as the one account in `.env`, whoever clicks.
- On the Free plan Jira refuses assign and snooze, and attachments are not readable.
- Reopening a closed alert is not possible through the public API.
- Notes cannot be edited or deleted here, and attachments cannot be uploaded.
- Jira reports the owner as an email address: enter that address as your name in Settings → Profile for "Assigned to Me".

## 0.1.0 (2026-11-19)

First release. A read-only console for the alerts of Jira Service Management Cloud → Operations. It starts in demo mode with sample data and connects to Jira once three values are set.

### Install on a new computer

Requires Node.js 20.12 or newer and git. The commands are the same on Windows, macOS and Linux.

```bash
git clone https://github.com/Ily83/JSM-Dashboard.git
cd JSM-Dashboard
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. A "Demo mode" badge is shown until Jira is configured.

To run the built version instead: `npm run build`, then `npm start`, then open <http://127.0.0.1:8787>.

### Update an existing copy

```bash
git pull
npm ci
```

Then restart `npm run dev` (or run `npm run build` and `npm start` again). Preferences saved in the browser are kept.

### Connect to Jira

The application has no login of its own. It connects to Jira with an Atlassian account email and an API token (not the account password).

1. Create a token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Copy `.env.example` to `.env` and set `JIRA_SITE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN`.
3. Restart the application.

The `.env` file stays on the computer: it is ignored by git, so it must be created again on each computer.

### Included

- Alert table: resizable, reorderable, hideable and sortable columns, virtualised rows, three densities, critical alerts highlighted, customers as coloured badges.
- Filters: priority, status, acknowledgement, customer, tag, service, team, assignee, source, integration type, created, updated, alert ID. Include or exclude values, match any or all, date ranges, global search.
- Quick filters: All, Critical, High, Unacknowledged, Assigned to Me, Multiple Customers, My Customers.
- Saved views: save, rename, duplicate, reorder, delete, set a default; optionally with column and dashboard layout. Four starter views.
- Dashboard: 11 widgets that can be shown, hidden, dragged and resized, with reset.
- Detail panel with description, customers, tags, responders, timestamps, extra properties and an "Open in Jira" link.
- Settings: appearance, refresh interval, visible information, profile, filter bar, columns, widgets, connection, reset.
- Backend: read-only Jira integration with paging, response validation, caching, rate-limit handling and stale data on failure.

### Tested

- 30 unit tests, including the Jira integration against a fake API (`npm test`).
- 41 checks in a headless browser in demo mode, with no console errors.
- 20,000 demo alerts: first rows in about 1 second, search in about 90 ms, smooth scrolling.

### Not tested yet

- **A real Jira site.** The integration follows the official API reference but has only run against a fake API. The README section "First run against a real site" lists what to check; each item is one setting in `.env` if it differs.
- Windows and macOS. Development and tests ran on Linux.

### Known limits

- Read-only: no acknowledge, close, assign or notes.
- Customers and services are derived from tags and extra properties by rules in `.env`, because Jira alerts have no such fields.
- User, schedule and escalation responders are shown by type and short id; only teams are shown by name.
- Closed alerts are loaded only if created within the last 72 hours (configurable).
- Preferences are stored per browser, not per user.
- Sign-in with OAuth 2.0 is not available; one account's API token is used for everyone on that computer.
