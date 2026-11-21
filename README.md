# Jira Operations – Alert Center

A local dashboard for Jira Service Management Cloud Operations alerts. It is **read-only by default** and runs in demo mode without Jira credentials.

[Release notes](RELEASE_NOTES.md) · [Backlog](BACKLOG.md)

## Windows portable app

On Windows x64, download the portable ZIP from [GitHub Releases](https://github.com/Ily83/JSM-Dashboard/releases), extract it, and double-click **Alert Center.exe**. No installer, administrator privileges, Node or npm are needed. The launcher starts the local backend and opens the dashboard in the default browser. Close the console window to stop it.

The ZIP ships with sample data and a blank `.env.example`. For live use, copy it to `.env` beside the EXE, configure your Jira connection, then restart. For [OAuth](#sign-in-with-atlassian-oauth), use a private app registration during testing; never distribute a shared client secret with the ZIP. Upgrades go in a fresh folder: copy your private `.env` and any mapping file across. Browser preferences stay with the same profile and dashboard URL.

**Build the ZIP:** With Go on `PATH` and the project's npm dependencies installed, run `npm run package:windows` on Windows, Linux or macOS. It downloads the pinned, checksum-verified Windows Node runtime and writes the ZIP and its SHA-256 checksum to `release/`. Run `npm run test:portable` to check the extracted package in demo and signed-out OAuth modes. On Windows the check runs the launcher itself. The prototype launcher is unsigned.

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

This uses a single API-token account. For browser sign-in instead, use OAuth below. Credentials stay on the backend, and `.env` is ignored by git. See `.env.example` for all settings.

For production, run `npm run build` followed by `npm start`; open <http://127.0.0.1:8787>.

### Sign in with Atlassian (OAuth)

1. Create a private **OAuth 2.0 (3LO)** app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/). Under **Authorization**, register `http://localhost:8787/api/auth/callback` exactly.
2. Under **Permissions**, add the Jira Service Management scopes `read:ops-alert:jira-service-management` and `read:ops-config:jira-service-management`. These cover alerts, teams and operations widgets. The app requests `offline_access` during consent to refresh the session.
3. In `.env`, set `JIRA_AUTH_MODE=oauth`, `JIRA_SITE_URL`, `JIRA_OAUTH_CLIENT_ID` and `JIRA_OAUTH_CLIENT_SECRET`. Email and API token are ignored in this mode. Leave `JIRA_WRITE_ACTIONS` empty for read-only use.
4. Run `npm run build` then `npm start`. Open **<http://localhost:8787>** in your usual browser, select **Sign in with Atlassian**, and grant access to the configured site. For `npm run dev`, register and set `JIRA_OAUTH_REDIRECT_URI=http://localhost:5173/api/auth/callback` instead and open `http://localhost:5173`. Use the same hostname throughout.

If you enable writes, also enable the corresponding console permissions and sign in again:

| Enabled action | Additional scope |
|---|---|
| Any alert write other than removing tags | `write:ops-alert:jira-service-management` |
| Remove tags | `delete:ops-alert:jira-service-management` |
| Maintenance writes | `write:ops-config:jira-service-management` |
| Assign or add responder (people picker) | Jira API `read:jira-user` |

OAuth uses the [JSM Operations gateway](https://developer.atlassian.com/cloud/jira/service-desk-ops/security/oauth-2-3lo-apps/) and the signed-in user's Jira permissions. One browser session is active per local backend. Access and rotating refresh tokens are held in backend memory; a restart, eight-hour session expiry, or **Settings → Connection → Sign out** requires a new sign-in. Signing out ends the local session; it does not sign you out of Atlassian or Windows. Preferences remain in the browser profile.

**Windows SSO:** Open the dashboard in your work Edge profile. If your Atlassian organization [federates the account with Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/saas-apps/atlassian-cloud-tutorial), the Atlassian login can reuse your Windows work session. An account chooser, consent or MFA may still appear according to policy. No separate Microsoft app registration is needed for this dashboard.

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

Actions include acknowledging, closing, assigning, snoozing, notes, tags and maintenance windows. Bulk actions report per-alert outcomes. Jira permissions and plan restrictions apply; actions use the signed-in OAuth user or the configured API-token account.

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
