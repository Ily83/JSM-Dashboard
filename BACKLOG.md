# Backlog

Wishlist items, not scheduled work. Items done in 0.2.0 are ticked; see RELEASE_NOTES.md.

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
- [ ] **Validate OAuth while the dedicated test site has Premium (until December 2026):** Start read-only: check consent, alert and attachment reads, refresh, and sign-out. Then enable only assign and snooze and try them on a disposable test alert as the signed-in user. Confirm the exact trial end date and run these checks before expiry. Separately, verify Windows SSO using an Entra-federated Atlassian account in a managed Windows work profile; Premium alone does not configure SSO. The local integration tests use a fake provider.
- [ ] **Next: Windows standalone portable app.** Unzip on a clean Windows PC, launch without installing Node or npm, and open the dashboard in the work browser for SSO. Verify startup, shutdown, OAuth callback, and upgrading to a new folder without losing settings. Track signing and managed distribution separately from the first portable build.
  - Portable x64 ZIP build and launcher implemented; see [build and verification instructions](README.md#windows-portable-app). Clean-Windows acceptance and signing remain open.
  - Distribution decision: Atlassian's documented code exchange requires a client secret. Keep an organization-owned secret on a confidential backend for a distributed app; never embed it in the installer. If the dashboard moves into an embedded window, sign in in the system browser and design a one-time, instance-bound handoff: the renderer does not share the browser's cookies. Only add persistent login if needed, with user-bound Windows credential protection.

## Operator workflows and AI assistance

- [x] **Operator-configured workflows:** Draft a trigger, conditions and action, preview which loaded alerts match, and copy a setup checklist into Jira Automation for unattended execution. Publishing stays in Jira: the documented rule-management API does not list OAuth 3LO support, and enabling or changing shared rules requires Jira permissions.
- [ ] **Local agent harness:** Let the operator connect a locally hosted agent or an organization-managed endpoint and choose which tools and alert fields it receives. Support approved MCP servers, including the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) for Azure documentation. Documentation lookups should use service names and symptoms rather than raw customer alert payloads.
- [ ] **AI-assisted investigation:** From an alert, ask “What should I check first?” Show likely causes, the evidence for each, ordered diagnostic checks, and possible fixes with links to the relevant runbook or Microsoft Learn page. Distinguish observations from hypotheses and flag missing evidence. Suggestions are read-only; the operator decides what to do.

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
