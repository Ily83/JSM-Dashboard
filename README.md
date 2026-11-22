# Jira Operations – Alert Center

A local dashboard for Jira Service Management Cloud Operations alerts. It is **read-only by default** and runs in demo mode without Jira credentials.

[Release notes](RELEASE_NOTES.md) · [Backlog](BACKLOG.md)

## Windows portable app

The desktop ZIP opens **Alert Center.exe** in its own window. Extract the entire ZIP before running it. No installer, administrator privileges, Node or npm are needed. Closing the window stops the local backend. The older v0.4.0 release is a browser launcher, not the desktop build.

The ZIP ships with sample data and a blank `.env.example`. For live use, copy it to `.env` beside the EXE, configure your Jira connection, then restart. OAuth opens the system browser for sign-in and returns to the app window. Use a private app registration for testing; never distribute a shared client secret with the ZIP. When upgrading, copy your private `.env` and any mapping file to the new folder. Desktop preferences live in the app's Windows user profile, separate from the browser.

**Build the ZIP:** Run `npm run package:windows` with npm dependencies installed. It verifies the pinned Electron runtime and writes the ZIP and SHA-256 checksum to `release/`. `npm run test:portable` checks the app window and loopback access on a Linux desktop.

**Managed Windows:** On a Windows build machine with the Windows SDK, set `WINDOWS_SIGN_CERT_SHA1` to the approved publisher's certificate thumbprint and `WINDOWS_SIGN_TIMESTAMP` to its RFC 3161 HTTPS timestamp service, then run `npm run package:windows -- --require-signing`. SignTool signs and verifies the launcher before packaging (`SIGNTOOL_EXE` can specify its path; `WINDOWS_SIGN_MACHINE_STORE=1` selects the machine store). Endpoint IT must approve the publisher and package under its policy. A checksum does not replace signing, and signing the launcher does not sign every file in the ZIP.

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
| Alert writes other than removing tags or deleting notes | `write:ops-alert:jira-service-management` |
| Remove tags or delete notes | `delete:ops-alert:jira-service-management` |
| Maintenance writes | `write:ops-config:jira-service-management` |
| Assign or add responder (people picker) | Jira API `read:jira-user` |

OAuth uses the [JSM Operations gateway](https://developer.atlassian.com/cloud/jira/service-desk-ops/security/oauth-2-3lo-apps/) and the signed-in user's Jira permissions. One browser session is active per local backend. Access and rotating refresh tokens are held in backend memory; a restart, eight-hour session expiry, or confirmed **Sign out** from the top bar requires a new sign-in. Signing out ends the local session; it does not sign you out of Atlassian or Windows. Preferences remain in the browser profile.

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

**Analyze** offers an overview by current status and priority, daily and monthly trends, rankings by source/team/tag, recurring alerts, P1 hotspots, response times and alerts per customer. Daily closure counts use known close times only for alerts created in the selected UTC date range. Filters apply to every chart and drill-down and can be saved under **Investigations**. Detail key/value filters use only the properties Jira includes in list results; the app marks incomplete results rather than fetching every alert.

Analysis runs in the backend in batches and continues while you use the dashboard. Progress is shown in History. Requests are paced and give interactive work priority, although Jira rate limits are shared. Results are held in memory until another analysis starts or the server restarts. A `+` or **Partial** indicates incomplete results. An alert with multiple customers counts once for each.

## Workflows

Open **Workflows** to draft an alert-created, alert-updated or status-changed rule. Choose team scope and conditions, then pick a log, Slack or email action. Preview uses the current fields of loaded alerts; it neither replays trigger events nor sends anything. Saved drafts stay in this browser and are separate from preferences backups.

Copy the checklist and configure the flow in Jira Automation. Start with a log action on a dedicated test site. An authorized operator must enable the flow in Jira, which then runs it even when the dashboard is closed. Any destinations or connections are configured in Jira, not in the dashboard.

## Write actions

Writes are disabled by default. To enable them, set `JIRA_WRITE_ACTIONS` in `.env` to `true` or a comma-separated list such as `acknowledge,unacknowledge,addNote`, then restart. See `.env.example` for action names. Test on a dedicated Jira site first.

Actions include acknowledging, closing, assigning, snoozing, notes, tags and maintenance windows. Bulk actions report per-alert outcomes. Jira permissions and plan restrictions apply; actions use the signed-in OAuth user or the configured API-token account.

Open an alert to edit or delete notes and upload attachments up to 10 MiB. Enable `editNote`, `deleteNote`, or `uploadAttachment` as needed. Demo writes only affect memory, and demo uploads retain metadata but not file contents. Reopening closed alerts is not available.

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

### Acceptance checks for the portable app, OAuth and History

1. **Managed Windows.** On the approved signing machine, build with `npm run package:windows -- --require-signing` as described [above](#windows-portable-app). Use a standard user on a managed Windows x64 device with normal SmartScreen and endpoint policy intact. Extract the package and double-click **Alert Center.exe**: demo should open in its own window, without a console or browser. Save a view, close the app, and verify the EXE exits and the loopback port is released. Extract a newer build to a fresh folder with the same port, copy only the private settings files you need, and verify the view is still there. For OAuth, sign in from inside the app; the system browser should handle sign-in and the app should regain focus and show alerts. Entra federation is not required. Do not bypass an endpoint block.
2. **Live OAuth on a dedicated Premium test site.** Confirm the exact trial expiry in Atlassian billing. Start with `JIRA_WRITE_ACTIONS=none`, consent to the test site, and open a disposable alert and download a known, non-sensitive attachment. To verify refresh, run the local web build with `LOG_LEVEL=debug`, keep the same signed-in session until it crosses the provider's access-token lifetime, then perform an uncached alert read. Check for `Atlassian OAuth token refresh succeeded` in the backend log and verify the read succeeds without new consent. Sign out and verify that an alert API read is denied until you sign in again. Only then restart with `JIRA_WRITE_ACTIONS=assign,snooze`, grant the [additional scopes](#sign-in-with-atlassian-oauth), and verify both operations in Jira on a single disposable alert as the signed-in user. Restore read-only mode afterward. Do not share the client secret, cookies, or callback URLs.
3. **High-volume History on a dedicated test site.** Pick a completed UTC range within the past year with more than 500 alerts and an independently known count of distinct alerts visible to the test account (for example, a retained fixture manifest). Account for `JIRA_ALERT_QUERY` in that count. Use `JIRA_AUTH_MODE=basic` with the test-site API-token credentials for this check, and explicitly confirm the site on the command line:

   ```bash
   npm run jira:validate-history -- --test-site https://YOUR-TEST-SITE.atlassian.net --from YYYY-MM-DD --to YYYY-MM-DD --expected COUNT
   ```

   The command runs the application's paced History scan without dashboard polling, refuses a mismatched site, sends only GET requests, and stops after 300 requests or 10 minutes. Record the unique count, partial flag, pages, HTTP request count, duration, and any HTTP 429 responses. Zero 429s means throttling was not observed, not that Jira has no rate limit. A matching count is a sanity check; where available, also compare the results with the independent fixture IDs. Record whether the dataset actually exceeded Jira's pagination ceiling; don't create alerts or deliberately trigger throttling just to reach it.

## Operations and limitations

- The browser refreshes every 60 seconds by default. The backend caches Jira data and retains the last successful result if Jira is unavailable.
- Maintenance, heartbeats and on-call widgets are optional. Maintenance coverage matches integration names, not policy or sync rules.
- The app resolves team, schedule and escalation responder names when available; otherwise it shows their IDs. Assign searches the Jira people directory, not just the alert's responders. Jira Free refuses some actions, including assign and snooze.
- `GET /healthz` checks the process; `GET /readyz` checks whether the first sync succeeded.
- The server listens on localhost by default. Enabled writes are checked by the backend, and cross-site write requests are rejected.

See [release notes](RELEASE_NOTES.md) for version-specific changes and testing.
