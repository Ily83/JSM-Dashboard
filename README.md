# Jira Operations – Alert Center

A local dashboard for Jira Service Management Cloud Operations alerts. It is **read-only by default** and runs in demo mode without Jira credentials.

[Release notes](RELEASE_NOTES.md) · [Backlog](BACKLOG.md)

## Get started

Requires Node.js 20.12 or newer.

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. To connect Jira:

1. Copy `.env.example` to `.env`.
2. Set `JIRA_SITE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN`. Create a token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
3. Restart the app. The demo badge disappears when connected.

The app has no separate login. Credentials stay on the backend, and `.env` is ignored by git. See `.env.example` for all settings.

For production, run `npm run build` followed by `npm start`; open <http://127.0.0.1:8787>.

## Customers and services

Jira alerts do not have a dedicated customer field. Configure how customers are identified in `.env`:

- `CUSTOMER_TAG_PREFIXES`: tags such as `customer:Acme`.
- `CUSTOMER_COMPANY_TAG_PREFIXES=Acme,Globex`: tags such as `Acme-site` or `Acme` identify customer `Acme`. Matching is case-insensitive, requires an exact name or a hyphen, and keeps the original tag available.
- `CUSTOMER_PROPERTY_KEYS`: extra properties containing customer names.
- `CUSTOMER_MAP_FILE`: a CSV or JSON mapping from alert entity to customers, for example `vm-acme-*,Acme`. Wildcards `*` and `?` are supported.

These rules combine. Services are derived from configured tags or properties, falling back to the alert entity. Jira may omit extra properties from its alert list, so the app fetches them separately within its configured limits.

## Dashboard

- Filter by customer, tag, status, priority, service and other fields. Use **More** for summary, service and assignee text matching.
- Search using plain text or queries such as `priority:P1 AND customer:Acme` or `NOT tag:test`. Select `?` beside search for syntax.
- Use the customer scope in the top bar to filter KPIs, widgets and the table. Customize widgets and table columns, group repeated alerts, or split the table into lanes.
- Drag a rectangle over alert rows to select them; hold Ctrl or Command to add to the selection. Drag near a table edge to scroll. Right-click a selected alert for bulk actions, or an unselected alert to select it. Bulk actions remain disabled in read-only mode.
- Save views locally, share filters with **Copy link**, or use **Settings → Backup** to export and import preferences. Backups exclude credentials and alert records, but may contain customer names and tags.
- Enable the P1 alarm from the top bar; sound and desktop notifications are configured in Settings.

Preferences and saved views are stored in the browser. The P1 alarm watches all loaded alerts, regardless of filters or customer scope.

## Alert history

Open **Alert history** to load alerts by creation date, up to 12 months back in UTC. Results include closed alerts still retained by Jira and respect `JIRA_ALERT_QUERY`.

**Analyze** offers monthly counts, recurring alerts, P1 hotspots, response times and alerts per customer. Customer and tag filters apply to all breakdowns; select a result to drill down. Save a selection under **Investigations**.

Analysis runs in the backend in batches and continues while you use the dashboard. Progress is shown in History. Requests are paced and give interactive work priority, although Jira rate limits are shared. Results are held in memory until another analysis starts or the server restarts. A `+` or **Partial** indicates incomplete results. An alert with multiple customers counts once for each.

## Write actions

Writes are disabled by default. To enable them, set `JIRA_WRITE_ACTIONS` in `.env` to `true` or a comma-separated list such as `acknowledge,unacknowledge,addNote`, then restart. See `.env.example` for action names. Test on a dedicated Jira site first.

Actions include acknowledging, closing, assigning, snoozing, notes, tags and maintenance windows. Bulk actions report per-alert outcomes. Jira permissions and plan restrictions apply; every action uses the configured `JIRA_EMAIL` account.

Demo actions only modify in-memory sample data. Reopening closed alerts, editing or deleting notes, and uploading attachments are not available in the app.

## Checks and test tools

| Command | Purpose |
| --- | --- |
| `npm test` | Unit and fake-Jira integration tests |
| `npm run typecheck` | TypeScript check |
| `npm run e2e` | Browser tests in demo mode; first install Chromium with `npx playwright install chromium` |
| `npm run test:coverage` | Generate `coverage/lcov.info` for SonarQube |
| `npm run e2e:live` | Creates and changes alerts on the configured Jira **test site** |
| `npm run jira:test-alerts -- create --yes` | Creates test alerts; `close --yes` closes them |
| `npm run jira:simulate -- run --yes` | Runs a test-site scenario; `cleanup --yes` closes its alerts and removes its heartbeat |

**Never run live tests, test-alert creation or simulation against a production site.** Demo mode can be forced with `DEMO_MODE=true`; `DEMO_ALERT_COUNT=20000` adds sample alerts for scale testing.

## Operations and limitations

- The browser refreshes every 60 seconds by default. The backend caches Jira data and retains the last successful result if Jira is unavailable.
- Maintenance, heartbeats and on-call widgets are optional. Maintenance coverage matches integration names, not policy or sync rules.
- Team responders can be named; users, schedules and escalations may appear as IDs. Jira Free refuses some actions, including assign and snooze.
- `GET /healthz` checks the process; `GET /readyz` checks whether the first sync succeeded.
- The server listens on localhost by default. Enabled writes are checked by the backend, and cross-site write requests are rejected.

See [release notes](RELEASE_NOTES.md) for version-specific changes and testing.
