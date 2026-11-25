# Jira Operations – Alert Center

A local dashboard for Jira Service Management Cloud Operations alerts. It is **read-only by default** and runs in demo mode without Jira credentials.

[Release notes](RELEASE_NOTES.md) · [Backlog](BACKLOG.md)

## Windows portable app

1. Extract the ZIP and open **Alert Center.exe**. No installer, Node or npm is needed.
2. The app starts with sample data. To connect Jira, open **Settings**, then **Configuration file**, fill in the Jira site and sign-in, and select **Save and reconnect**. See [OAuth](#sign-in-with-atlassian-oauth) for sign-in.
3. Close the window to stop the app. For upgrades, copy your private `.env` and mapping file to the new folder. Desktop preferences stay in your Windows profile.

### Configuration file in the desktop app

**Settings > Configuration file** edits the `.env` file beside the EXE and applies it without a restart. The sign-in page links to the same settings, so a wrong site or client ID can be corrected while signed out.

- **Editable:** the Jira site and sign-in, the customer and service rules, the mapping file, which alerts are loaded, and the "Open in Jira" link. Comments and other lines in the file are kept.
- **Hand edit only:** `JIRA_WRITE_ACTIONS` (the app cannot switch its own write actions on), `PORT`, `HOST`, the OAuth callback and the tuning values. Restart after changing these.
- **Secrets** are write-only: the API token and OAuth client secret are never shown again. They are stored in `.env` as before, so keep that file private.
- **Changing the Jira site** asks for the API token again, and removes a saved `JIRA_CLOUD_ID` of the old site. With OAuth, a saved API token is removed instead.
- **Saving reconnects:** with OAuth you sign in again. Values set in the computer's environment win over the file and show as locked.
- Only the app's own window can read or change these settings; a browser on the same computer is refused. In browser mode (`npm start`) the file stays a hand edit.

Build with `npm ci` and `npm run package:windows`. The ZIP and checksum are saved in `release/`. Run `npm run test:portable` for the Linux desktop smoke test. The older v0.4.0 release is a browser launcher, not the desktop build.

**Managed Windows:** Use an IT-approved signed build. On a Windows build machine with the Windows SDK, set `WINDOWS_SIGN_CERT_SHA1` and the HTTPS RFC 3161 `WINDOWS_SIGN_TIMESTAMP`, then run `npm run package:windows -- --require-signing`. Optionally set `SIGNTOOL_EXE` or `WINDOWS_SIGN_MACHINE_STORE=1`. Signing covers the launcher, not every ZIP file; a checksum is not a signature.

Never distribute an OAuth client secret in the ZIP. Use a private registration for testing; distributed apps need a confidential backend for the secret.

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

This uses one API-token account. For individual sign-in, use OAuth below. Credentials stay on the backend; `.env` is ignored by git.

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

OAuth uses the [JSM Operations gateway](https://developer.atlassian.com/cloud/jira/service-desk-ops/security/oauth-2-3lo-apps/) and the user's Jira permissions. One session is active per backend; tokens remain in memory. Restarting, session expiry after eight hours, or signing out requires a new sign-in. Local sign-out does not sign you out of Atlassian or Windows.

## Customers and services

Jira alerts do not have a dedicated customer field. Configure how customers are identified in `.env`:

- `CUSTOMER_TAG_PREFIXES`: tags such as `customer:Acme`.
- `CUSTOMER_COMPANY_TAG_PREFIXES=Acme,Globex`: tags such as `Acme-site` or `Acme` identify customer `Acme`. Matching is case-insensitive, requires an exact name or a hyphen, and keeps the original tag available.
- `CUSTOMER_PROPERTY_KEYS`: extra properties containing customer names.
- `CUSTOMER_MAP_FILE`: a CSV or JSON mapping from alert entity to customers, for example `vm-acme-*,Acme`. Wildcards `*` and `?` are supported.

Rules combine. Services come from configured tags or properties, falling back to the entity. Extra properties may require separate, limited detail reads.

## Dashboard

- Filter by customer, tag, status, priority, service and other fields. Use **More** for summary, service and assignee text matching.
- Search using plain text or queries such as `priority:P1 AND customer:Acme` or `NOT tag:test`. Select `?` beside search for syntax.
- Use the customer scope in the top bar to filter KPIs, widgets and the table. Customize widgets and table columns, group repeated alerts, or split the table into lanes.
- Drag a rectangle over alert rows to select them; hold Ctrl or Command to add to the selection. Drag near a table edge to scroll. Right-click a selected alert for bulk actions, or an unselected alert to select it. Bulk actions remain disabled in read-only mode.
- Save views locally, share filters with **Copy link**, or use **Settings → Backup** to export and import preferences. Backups exclude credentials and alert records, but may contain customer names and tags.
- Enable the P1 alarm from the top bar; sound and desktop notifications are configured in Settings.

Preferences and saved views are stored in the browser. The P1 alarm watches all loaded alerts, regardless of filters or customer scope.

## Alert history

Open **Alert history** to search retained alerts by UTC creation date, up to 12 months back. `JIRA_ALERT_QUERY` still applies.

**Analyze** shows trends, rankings, recurring alerts, P1 hotspots, response times and customer counts. Status is current, not a historical snapshot; daily closures cover alerts created in the selected range. Save filters under **Investigations**. Detail filters use only properties included in Jira's list results.

Analysis runs in paced background batches. Results stay in memory until another analysis starts or the server restarts; **Partial** or `+` marks incomplete results. Jira rate limits are shared with dashboard requests. Alerts with multiple customers count once per customer.

## Workflows

Draft a rule under **Workflows**, then configure and enable it in Jira Automation. Preview uses loaded alerts and sends nothing. Drafts stay in this browser and are excluded from preferences backups. Start with a log action on a dedicated test site.

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
| `npm run e2e:live` | Creates and changes alerts on the configured Jira **test site** with the API token (forces basic sign-in for its own server) |
| `npm run e2e:live:login`, then `npm run e2e:live:oauth` | Checks writes as the signed-in OAuth user on your running instance (below) |
| `npm run jira:test-alerts -- create --yes` | Creates test alerts; `close --yes` closes them |
| `npm run jira:simulate -- run --yes` | Runs a test-site scenario; `cleanup --yes` closes its alerts and removes its heartbeat |

**Never run live tests, test-alert creation or simulation against a production site.** Demo mode can be forced with `DEMO_MODE=true`; `DEMO_ALERT_COUNT=20000` adds sample alerts for scale testing.

### Live tests with OAuth

OAuth sessions exist only in the memory of the instance you signed in to, so these tests use your running instance (the origin of `JIRA_OAUTH_REDIRECT_URI`, or `E2E_LIVE_URL`). Test site only.

1. Enable the actions to test in `JIRA_WRITE_ACTIONS`, then `npm run build` and `npm start`.
2. On the test site, create one disposable open alert tagged `alert-center-oauth-e2e`. The tests change only that alert.
3. `npm run e2e:live:login` opens Chromium: sign in and grant access; the window closes by itself. This signs out other browsers on that instance.
4. `npm run e2e:live:oauth`. Each test notes Jira's answer. The alert stays assigned to you and keeps the uploaded file; a snooze can last its 5 minutes. The maintenance test keeps a global alert policy in its current state and cancels the window at once.
5. For token refresh, run `npm run e2e:live:oauth -- -g "token refresh"` between one and eight hours after signing in.
6. Delete the saved sign-in afterwards: `rm e2e/.auth/oauth-session.json`. It is a live session (git-ignored, mode 0600).

### Acceptance checks for the portable app and History

These checks remain open; use a dedicated test site, not production.

1. **Managed Windows:** Test an IT-approved signed ZIP with normal endpoint policy. Check demo startup, saved views after an upgrade, shutdown and port release, and OAuth handoff to the system browser and back. Do not bypass an endpoint block.
2. **High-volume History:** On a dedicated test site, choose a completed UTC range with over 500 alerts and an independently known distinct count, accounting for `JIRA_ALERT_QUERY`. Set `JIRA_AUTH_MODE=basic` and test-site credentials:

   ```bash
   npm run jira:validate-history -- --test-site https://YOUR-TEST-SITE.atlassian.net --from YYYY-MM-DD --to YYYY-MM-DD --expected COUNT
   ```

   The read-only scan stops after 300 requests or 10 minutes. Record the count, partial flag, pages, requests, duration and 429 responses; compare fixture IDs if available. Note whether the pagination ceiling was reached. Do not create alerts or deliberately trigger throttling.

## Operations and limitations

- The browser refreshes every 60 seconds by default. The backend caches Jira data and retains the last successful result if Jira is unavailable.
- Maintenance, heartbeats and on-call widgets are optional. Maintenance coverage matches integration names, not policy or sync rules.
- The app resolves team, schedule and escalation responder names when available; otherwise it shows their IDs. Assign searches the Jira people directory, not just the alert's responders. Jira Free refuses some actions, including assign and snooze.
- `GET /healthz` checks the process; `GET /readyz` checks whether the first sync succeeded.
- The server listens on localhost by default. Enabled writes are checked by the backend, and cross-site write requests are rejected.

See [release notes](RELEASE_NOTES.md) for version-specific changes and testing.
