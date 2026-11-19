# Release notes

Newest release first. Each release lists what changed, how to install or update, and what is known not to work yet.

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
