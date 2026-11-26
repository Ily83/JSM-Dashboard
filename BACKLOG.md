# Backlog

Wishlist items, not scheduled work. Items done in 0.2.0 are ticked; see RELEASE_NOTES.md.

See the [acceptance checks](README.md#acceptance-checks-for-the-portable-app-and-history) for the two open validation items.

## Jira alert actions

- [x] Add single-alert actions: Acknowledge, Unacknowledge (shown as **Open** on an acknowledged alert in Jira), Close, Assign, Add responder, Snooze, and Escalate. Verify whether the public API can match Jira's **Escalate to next** behavior before using that label.
  - Done. The API operation is itself named "Escalate alert to next" and needs the escalation to move along, so the picker offers the escalations of the alert's teams and those already on the alert. Verified live in 0.3.0.
- [x] Add multi-select and bulk acknowledge. The public API acknowledges one alert per request, so show the selected count before confirmation and report successes and failures for each alert.
  - Done, for acknowledge, unacknowledge and close. Alerts an action does not fit are skipped and counted.
- [x] Consider additional capabilities: view or add notes, change priority, edit tags, and view or upload attachments. Reading notes and attachments can be considered separately from enabling writes.
  - Done: notes (read and add), activity log, priority, tags, attachment list and download. Reading works without enabling writes.
- [x] Upload attachments and edit or delete notes. Each is a separate opt-in write capability; Jira permissions and plan limits still apply.
- [x] Investigate reopening a closed alert. This is different from unacknowledging an open alert; there is no dedicated reopen endpoint in the current public [Jira Operations Alerts API reference](https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-alerts/).
  - Checked the OpenAPI document again: still no reopen endpoint, and acknowledging a closed alert is refused ("You cannot acknowledge a closed alert", seen live). Not possible through the public API.

Before enabling writes, verify Jira permissions, make writes opt-in, and use demo data or a dedicated Jira test site for development and testing. Do not test write actions on the live dashboard.

Done that way: writes are off unless `JIRA_WRITE_ACTIONS` enables them, and they were developed on demo data and tried on a trial site only. On the Free plan, assign and snooze are refused by Jira ("Your account plan does not support…") and attachments answer 403; on a Premium trial all three work. Check your plan and permissions.

## Read-only alert analytics

- [x] **Recurring alerts:** Rank recurring alert groups by Jira alias, with source and normalized summary as a fallback. Show distinct alert records and Jira occurrence counts separately. Click a group to inspect the matching alerts.
- [x] **P1 hotspots:** Rank customers, services, or alert groups by P1 alert count. Include a P1-only toggle in Recurring alerts and let users drill into the matching alerts.
- [x] **Alerts per customer:** Add a ranked horizontal bar chart in History for all priorities, with an optional P1-only filter. Click a customer to inspect the matching alerts. Count each alert once per affected customer and note that alerts affecting multiple customers can appear in more than one bar, so the bars may sum to more than the distinct alert total.

Reuse the History date, customer, and tag filters. Label rankings as partial when the analysis limit is reached or records could not be read.

### Historical analytics gaps

- [x] **High-volume background analysis:** Scan beyond 500 alerts per month in paced, low-priority batches; split dense windows around Jira's pagination limit and label incomplete results. Progress and cancellation are available; jobs and results remain in memory until the backend restarts or another analysis starts.
- [ ] **Validate high-volume analysis on a dedicated Jira test site:** Confirm request cost, rate limits, pagination and completeness against representative production-like volumes. Never use live writes for testing.
  - Test data is ready: over 500 alerts tagged `alert-center-volume` were created on the trial site on 2026-11-25. The validation script only accepts a finished UTC day, so run it from 2026-11-26 with `--from 2026-11-25 --to 2026-11-25`.
  - Read-only Premium run on 2026-11-26: 572 distinct alerts matched Jira's reported total for that UTC day and tag. Six pages, seven HTTP requests including tenant discovery, about seven seconds, no partial results or 429s. An independent fixture manifest and a live dataset beyond the pagination ceiling were not available.
- [x] **Historical overview:** Total alerts and breakdowns by current status and priority for the selected creation-date range.
- [x] **Daily trends:** UTC creation counts, daily average, and a comparison to known closure dates for the same creation cohort.
- [x] **Historical rankings:** Rank sources, team responders and tags, with drill-down and one count per alert per team or tag.
- [x] **History filters:** Charts and drill-downs share source and tag inclusion/exclusion, integration, status, priority, message inclusion/exclusion, and available detail key/value filters. Filters are saved with investigations; missing detail fields are flagged.

Time-of-day, weekday, and business-hours patterns are not planned unless requested.

## Saved views and dashboard usability

- [x] **Export and import settings:** Export a single saved view or a full preferences backup as versioned JSON. Preview and validate imports, and offer **Keep both** or **Replace** for conflicting views. Never include Jira credentials or alert records; warn that saved customer names and tags can still be sensitive.
- [x] **Reusable customer dashboard:** Switch customers without duplicating saved views. Let users apply the customer selection to KPIs, charts, and the alert table together, and clearly label whether metrics are filtered or global.
- [x] **Saved History investigations:** Save and reopen a date range, customer and tag filters, and the selected breakdown. Carry those filters into the alert list when drilling down from a chart.
- [x] **Group repeats in the live table:** Offer expandable alert groups with separate counts for distinct Jira records and total Jira occurrences. Keep individual alerts accessible and reuse the grouping rules from Recurring alerts.

## Standalone app and authentication

- [x] **Local browser OAuth sign-in:** Implemented Atlassian 3LO with backend-only in-memory tokens, refresh and session-specific caches. [Setup and scopes](README.md#sign-in-with-atlassian-oauth).
- [x] **Validate OAuth while the dedicated test site has Premium (until December 2026):** Live browser consent, alert listing (30 alerts synced, none skipped), and sign-out returning to the login page passed on 2026-11-22.
  - Done on 2026-11-25 with `npm run e2e:live:oauth`: all 9 checks passed as the signed-in user on a disposable alert. They covered acknowledge, notes, tags, assign, snooze, attachment upload and download link, a global maintenance window, and reads after the access token expired and was refreshed. The trial ends on 2026-12-19.
- [x] **Alert notification settings in the app:** contact methods and notification rules of the signed-in user, behind `notifications` in `JIRA_WRITE_ACTIONS`. Done in 0.6.0; Do Not Disturb and registering a phone are not in the public API.
- [x] **Edit the configuration file from the desktop app:** Settings > Configuration file writes the connection, customer and alert settings to `.env` and reconnects without a restart. Write actions, the port and the OAuth callback stay a hand edit. Done in 0.5.0; see the [README](README.md#configuration-file-in-the-desktop-app).
- [ ] **Windows standalone portable app.** The original browser launcher is replaced in source by an Electron desktop window. Verify startup, shutdown, system-browser OAuth handoff, and upgrading on managed Windows with a build signed by an approved publisher.
  - [Build and signing instructions](README.md#windows-portable-app). Approved signing and managed Windows acceptance remain open.
  - The desktop build implements a one-time handoff from the system browser. Atlassian's documented code exchange requires a client secret. Keep an organization-owned secret on a confidential backend for a distributed app; never embed it in the installer. Only add persistent login if needed, with user-bound Windows credential protection.

## Operator workflows and AI assistance

- [x] **Operator-configured workflows:** Draft a trigger, conditions and action, preview which loaded alerts match, and copy a setup checklist into Jira Automation for unattended execution. Publishing stays in Jira: the documented rule-management API does not list OAuth 3LO support, and enabling or changing shared rules requires Jira permissions.
- [ ] **Local agent harness:** Let the operator connect a locally hosted agent or an organization-managed endpoint and choose which tools and alert fields it receives. Support approved MCP servers, including the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) for Azure documentation. Documentation lookups should use service names and symptoms rather than raw customer alert payloads.
- [ ] **AI-assisted investigation:** From an alert, ask “What should I check first?” Show likely causes, the evidence for each, ordered diagnostic checks, and possible fixes with links to the relevant runbook or Microsoft Learn page. Distinguish observations from hypotheses and flag missing evidence. Suggestions are read-only; the operator decides what to do.

## Jira API usage and rate limits

Measured on the live site on 2026-11-26 (one backend, 09:38–11:07 UTC, about 2,500–3,050 alerts loaded, no 429 and no skipped alerts):

| Period | Sync interval | Requests per sync | Approximate rate |
| --- | --- | --- | --- |
| Startup full sync | once, about 10 s | 77 | about 8 requests/s burst |
| 09:38–10:04 | about 35 s | 70 (full: 76–77) | about 2 requests/s, 120/min |
| 10:04–11:07 | about 63 s, some 2–3 min gaps | 33–61 (full: 44–61) | about 0.6–0.9 requests/s |

Atlassian does not publish rate limits or their scope (site, organization, user or token) for the JSM Operations API (`api.atlassian.com/jsm/ops/api/{cloudId}`). Jira platform burst limits are per site, endpoint and HTTP method, not per user, so every desktop instance and other integration on the site may share the same allowance.

- [ ] **Track the production team's existing Atlassian support case:** confirm the applicable JSM Operations limits and their scope. Do not open a duplicate case.
- [x] **Cap the request rate:** space Jira calls and retries at a configurable per-backend budget (`JIRA_REQUESTS_PER_SECOND`, default 4) in addition to the concurrency limit.
- [x] **Read rate-limit headers:** log allowlisted rate-limit headers, slow down on enforced near-limit hints, respect `Retry-After`, and include HTTP 429 counts and auth mode in sync diagnostics. Tested throttling with a fake upstream.
- [ ] **Lower the cost per sync:** detail, responder and directory results are already reused. The public Alerts API does not document filtering by `updatedAt`; do not replace the open-alert scan with a creation-time filter, which would miss changes to older alerts.
- [ ] **Explain the 35 s cadence:** the early syncs ran about every 35 s although the default refresh is 60 s. Staggered tabs or focus refetches can start a sync once the 30 s cache expires, but the earlier logs cannot identify which trigger occurred.
- [x] **Document the cost of multiple desktop instances:** each instance polls Jira separately; recommend one appropriately secured shared backend for a team. Measure independent instances only in normal use; same-backend tabs share the cache.

On the dedicated test site, observe normal use only, noting browser refresh interval, auth mode, alert volume and any response headers. Atlassian [forbids rate-limit testing](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/#testing-and-compliance) against cloud tenants, test sites included. Test 429 and `Retry-After` with a fake upstream, never by flooding a site.

Read-only Premium observation on 2026-11-26 (API token, one backend, 60 s polling): 523 alerts, none skipped. Cold sync used 44 requests in 11.2 s; two simultaneous tab-equivalent polls shared one light sync (11 requests in 2.7 s). Both phases peaked at four request starts in a rolling second. No 429s or rate-limit headers were observed. This verifies the app's cap, not the site's quota; the larger baseline above used a different alert volume. Independent desktop instances and OAuth traffic were not measured in this run.

- Local `npm run test:load:jira`: 50,000 distinct History records recovered in 504 paced requests. Under a simulated shared quota, 16 desktops each stayed at four requests/sec but together still hit 429s. Each kept its cached 2,500 alerts and recovered on staggered polls after backoff. Simulated external automation also throttled a single desktop; it could preserve a warm cache but could not populate a cold one.
- [ ] **Production rollout:** Pilot a lower app budget with a small group and monitor request volume, stale data and 429s during normal use. Coordinate the app's request budget across backend instances before broad rollout. The simulated quota is not evidence of a real limit.

## Ideas from similar projects

Compared with karma, Alerta, Keep, Siren and jsm-tui on 2026-11-19. Scope: Jira Service Management only.

- [x] P1 alarm: sound and desktop notification, P1 only.
- [x] Single-key actions.
- [x] Clickable links and a runbook button.
- [x] Filters in the URL and Copy link.
- [x] Health endpoints.
- [x] Run the alert's custom actions.
- [x] MTTA and MTTR in History.
- [x] Maintenance windows: list, create, end.
- [x] Heartbeats.
- [x] Who is on call now.
- [x] Lanes by customer, service or team.
- [x] 24-hour activity strip per alert group.
- [x] Personal watch list.
- [x] Customers from an entity mapping file.
- [x] Query language in search.
- [x] Resolve live schedule and escalation responder names using the picker directory where available; fall back to IDs.
- [x] Keep the Jira people directory for Assign and Assign to me: an assignee does not need to be an existing responder. Jira permissions still apply.

Not planned: several Jira sites in one console, application-managed per-person roles, correlating alerts into incidents, or an always-on automation engine in the desktop app.
