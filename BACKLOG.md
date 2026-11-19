# Backlog

Wishlist items, not scheduled work. Items done in 0.2.0 are ticked; see RELEASE_NOTES.md.

## Jira alert actions

- [x] Add single-alert actions: Acknowledge, Unacknowledge (shown as **Open** on an acknowledged alert in Jira), Close, Assign, Add responder, Snooze, and Escalate. Verify whether the public API can match Jira's **Escalate to next** behavior before using that label.
  - Done. The API operation is itself named "Escalate alert to next" and needs the escalation to move along, so the picker offers the escalations of the alert's teams and those already on the alert. Not tried live yet: the test site has no Operations team or escalation.
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

## Saved views and dashboard usability

- [x] **Export and import settings:** Export a single saved view or a full preferences backup as versioned JSON. Preview and validate imports, and offer **Keep both** or **Replace** for conflicting views. Never include Jira credentials or alert records; warn that saved customer names and tags can still be sensitive.
- [x] **Reusable customer dashboard:** Switch customers without duplicating saved views. Let users apply the customer selection to KPIs, charts, and the alert table together, and clearly label whether metrics are filtered or global.
- [x] **Saved History investigations:** Save and reopen a date range, customer and tag filters, and the selected breakdown. Carry those filters into the alert list when drilling down from a chart.
- [x] **Group repeats in the live table:** Offer expandable alert groups with separate counts for distinct Jira records and total Jira occurrences. Keep individual alerts accessible and reuse the grouping rules from Recurring alerts.
