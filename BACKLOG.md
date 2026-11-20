# Backlog

Wishlist items, not scheduled work. Items done in 0.2.0 are ticked; see RELEASE_NOTES.md.

## Jira alert actions

- [x] Add single-alert actions: Acknowledge, Unacknowledge (shown as **Open** on an acknowledged alert in Jira), Close, Assign, Add responder, Snooze, and Escalate. Verify whether the public API can match Jira's **Escalate to next** behavior before using that label.
  - Done. The API operation is itself named "Escalate alert to next" and needs the escalation to move along, so the picker offers the escalations of the alert's teams and those already on the alert. Verified live in 0.3.0.
- [x] Add multi-select and bulk acknowledge. The public API acknowledges one alert per request, so show the selected count before confirmation and report successes and failures for each alert.
  - Done, for acknowledge, unacknowledge and close. Alerts an action does not fit are skipped and counted.
- [x] Consider additional capabilities: view or add notes, change priority, edit tags, and view or upload attachments. Reading notes and attachments can be considered separately from enabling writes.
  - Done: notes (read and add), activity log, priority, tags, attachment list and download. Reading works without enabling writes.
- [ ] Upload attachments, edit and delete notes. The API has endpoints for them; not offered yet.
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
- [ ] **Historical overview:** Show total alerts and breakdowns by current status and priority for the selected creation-date range. Clearly distinguish current status from status at creation or a historical snapshot.
- [ ] **Daily trends:** Show alerts created per day, with breakdowns by current status or priority and a daily average. Compare created and closed alerts where reliable closure timestamps are available; label the date and status semantics and any missing data.
- [ ] **Historical rankings:** Rank alerts by source, team, and tag for the selected date range, with counts and drill-down. Explain how alerts with multiple teams or tags are counted.
- [ ] **History filters:** Extend filters across historical charts and drill-downs to cover source, integration, status, priority, message include/exclude and, where available, alert-detail keys and values. Support tag and source inclusion/exclusion, and make timezone and date boundaries explicit. Label filters or results as incomplete when required data is unavailable.

Time-of-day, weekday, and business-hours patterns are not planned unless requested.

## Saved views and dashboard usability

- [x] **Export and import settings:** Export a single saved view or a full preferences backup as versioned JSON. Preview and validate imports, and offer **Keep both** or **Replace** for conflicting views. Never include Jira credentials or alert records; warn that saved customer names and tags can still be sensitive.
- [x] **Reusable customer dashboard:** Switch customers without duplicating saved views. Let users apply the customer selection to KPIs, charts, and the alert table together, and clearly label whether metrics are filtered or global.
- [x] **Saved History investigations:** Save and reopen a date range, customer and tag filters, and the selected breakdown. Carry those filters into the alert list when drilling down from a chart.
- [x] **Group repeats in the live table:** Offer expandable alert groups with separate counts for distinct Jira records and total Jira occurrences. Keep individual alerts accessible and reuse the grouping rules from Recurring alerts.

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
- [ ] Names for schedule and escalation responders in live mode (the lists are already loaded for the pickers).
- [ ] Decide whether "assign" may keep using the general Jira people search (`/rest/api/3/user/search`, `/rest/api/3/myself`), or should offer only the alert's responders, to stay strictly within JSM.

Not planned: several Jira sites in one console, per-person sign-in with roles, correlating alerts into incidents, automated workflows.
