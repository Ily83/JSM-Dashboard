# Jira Operations – Alert Center

A faster, denser, read-only console for the alerts of Jira Service Management Cloud → Operations.
It runs on your own computer, shows which customers each alert affects at a glance, and never changes anything in Jira.

Without Jira credentials it starts in **demo mode** with 30 realistic sample alerts, so everything can be tried immediately.

What each release contains, and how to install or update it: [RELEASE_NOTES.md](RELEASE_NOTES.md).
Proposed features: [BACKLOG.md](BACKLOG.md).

## Quick start

Requires Node.js 20.12 or newer.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The interface shows a "Demo mode" badge until Jira is configured.

| Command | What it does |
| --- | --- |
| `npm run dev` | Backend on port 8787 and frontend on port 5173, both reloading on change |
| `npm run build` then `npm start` | Production build, served by the backend on <http://127.0.0.1:8787> |
| `npm test` | Unit tests, including the Jira integration against a fake API |
| `npm run typecheck` | TypeScript check of frontend, backend and shared code |

To try large volumes in demo mode: `DEMO_ALERT_COUNT=20000 npm run dev`.

## Connecting to Jira

1. Copy `.env.example` to `.env`.
2. Fill in three values:
   - `JIRA_SITE_URL`, for example `https://your-company.atlassian.net`
   - `JIRA_EMAIL`, an Atlassian account that can see Operations alerts
   - `JIRA_API_TOKEN`, created at <https://id.atlassian.com/manage-profile/security/api-tokens>
3. Restart `npm run dev`. The badge disappears and the top bar shows the last synchronisation time.

The application has no login of its own; it connects to Jira with that account's email and API token (not its password). Credentials are read by the backend only. They are never sent to the browser, never written to logs, and `.env` is ignored by git.

### First run against a real site: what to check

The integration follows the official API reference and is covered by tests against a fake API, but it has not yet been run against a real Jira site. On the first live run, check these points, each of which is one setting if it differs:

| Check | If it is wrong |
| --- | --- |
| Alerts appear and the count matches Jira's open alerts | See the server log line `jira sync complete`. A 401 or 403 is reported in the red banner. |
| Acknowledged and snoozed alerts are included | The backend asks for `status: open`. If your site treats acknowledged alerts as a separate status, change `JIRA_OPEN_QUERY` and `JIRA_CLOSED_QUERY`. |
| Customers show as badges | Set `CUSTOMER_TAG_PREFIXES` or `CUSTOMER_PROPERTY_KEYS` to match how your alerts name customers. |
| Service column is filled | Set `SERVICE_PROPERTY_KEYS` or `SERVICE_TAG_PREFIXES`; by default the alert's entity is used. |
| "Open in Jira" opens the alert | Adjust `JIRA_ALERT_URL_TEMPLATE`. |
| Responders show team names | Needs permission to list teams; otherwise a short id is shown. |

## What the Jira API provides, and what it does not

Checked against the official reference and its OpenAPI document
(<https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-alerts/>).

Endpoints used, all `GET`:

| Purpose | Endpoint |
| --- | --- |
| List alerts | `https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/alerts` |
| One alert | `…/v1/alerts/{id}` |
| Team names | `…/v1/teams` |
| Find the cloudId | `https://{site}/_edge/tenant_info` (no credentials sent) |

Authentication is HTTP Basic with account email and API token. (OAuth 2.0 with scope `read:ops-alert:jira-service-management` is the alternative for a deployed version.)

Facts that shaped the design:

- **Paging.** `size` is at most 100, and `offset + size` must stay below 20,000. Sorting is possible by `createdAt`, `insertedAt`, `lastOccurredAt` or `priority`.
- **No customer field.** An alert has `tags` (text) and `extraProperties` (key and value). Customers are therefore derived by configurable rules: a tag prefix such as `customer:Contoso`, or a property such as `customer = Contoso, Fabrikam`.
- **No service field in the response.** Affected services can be attached to an alert, but the alert response does not return them. The service is taken from a `service:` tag, then a `service` property, then the alert's `entity`.
- **Responders are ids.** Only `id` and `type` are returned. Team names come from the List teams endpoint; users, schedules and escalations are shown by type and short id. The assignee comes from `owner`, which is a display name.
- **Extra properties may be missing from the list.** The reference says the list returns them; users report it does not, and only "Get alert" does. The backend handles both: if the list omits them, it fetches them per alert, at most `JIRA_ENRICH_MAX_PER_SYNC` per run, and never twice for an unchanged alert.
- **No "changed since" filter.** The documented search fields include `createdAt` and `lastOccurredAt` but not `updatedAt`, so a true delta query is not possible. See "Synchronisation" below for what is done instead.
- **No saved searches in the API.** The reference has no endpoint for the saved searches of the Jira alert list, so they cannot be imported. Saved views in this application are its own.
- **Rate limits.** The reference documents status 429 without numbers. The backend honours `Retry-After`, backs off, and keeps serving the last good data.

## Synchronisation

- The browser asks the backend for alerts every 60 seconds by default (changeable per user, paused while the tab is hidden).
- The backend asks Jira at most once per `JIRA_CACHE_TTL_SECONDS` (30), no matter how many tabs or people are connected, and only while somebody is looking.
- Most runs are **light**: open alerts only. Alerts that were open and are now missing are looked up one by one, which is how a closed alert is noticed without reloading everything.
- Every `JIRA_FULL_SYNC_MINUTES` (15) a **full** run also reloads recently closed alerts and team names.
- The list has a content version. If nothing changed, the browser receives about 250 bytes and no table row re-renders.
- If Jira fails, the last good data stays on screen with a red banner and the time of the last successful synchronisation.

## Filtering

All filters run in the browser on the loaded alerts, so they are instant, work the same in demo and live mode, and cause no API requests. Only the base scope is applied by Jira: open alerts, recently closed alerts, and `JIRA_ALERT_QUERY` if set.

| Filter | Based on | In Jira's alert search syntax |
| --- | --- | --- |
| Priority | `priority` | not listed in the search syntax article |
| Status | `status`, `acknowledged`, `snoozed` | `status` (open, closed), `acknowledged`, `snoozed` |
| Acknowledgement | `acknowledged` | `acknowledged` |
| Customer | derived, see above | `tag` or `details.key` / `details.value`, depending on your convention |
| Tag | `tags` | `tag` |
| Service | derived, see above | none |
| Team | team responders | `teams` |
| Assignee | `owner` | `owner` |
| Source | `integrationName`, else `source` | `integration.name`, `source` |
| Integration type | `integrationType` | `integration.type` |
| Created | `createdAt` | `createdAt` |
| Updated | `updatedAt` | not searchable |
| Alert ID | `tinyId`, `id`, `alias` | `tinyId`, `alertId`, `alias` |

Rules: different filters combine with AND. Within a filter, selected values combine with OR ("Any"), or with AND ("All") for customers, tags and teams. Any value can be excluded instead of included. Each active filter shows its value on its button with its own clear button.

Under **More**, use **Summary**, **Service contains**, or **Assignee contains** to match a case-insensitive word or phrase in that field only. These can be combined with the existing exact-value and status filters.

## Alert history

Open **Alert history** in the sidebar, choose creation dates up to 12 months back (UTC), and select **Load history**. Use **Older dates** and **Newer dates** to move between windows of up to 31 days, and **Next page** to browse the current window. History is read-only, includes closed alerts, and only shows alerts Jira still retains and the configured account can read. The `JIRA_ALERT_QUERY` restriction still applies. If a date window hits Jira's pagination limit, select a shorter range.

Choose **Analyze by month** to see a histogram of alerts created in each calendar month. Filter the chart by customer, tag, or both, and select a bar to see its matching alerts. Filters use the same derived customers and tags as the alert list. The chart counts up to 500 records per month; a `+` marks a lower bound, including when records could not be read. Use **Load history** for paged browsing beyond that cap.

History does not change the live dashboard's limits or poll Jira in the background.

## Customising

Everything is stored per browser and survives a reload.

- **Dashboard.** The grid icon in the top bar enters edit mode: drag widgets, resize them from the corner, hide them, add others. Settings offers the same with the keyboard. The optional "Alerts by tag" widget ranks active alerts by tag; selecting a tag filters the table.
- **Table.** Drag a header to move a column, drag its edge to resize, double-click the edge to reset; arrow keys work on a focused edge. Click a header to sort, Shift+click for a second level.
- **Saved views.** A view stores section, quick filter, filters, search and sorting, and optionally columns, dashboard and density. Views can be renamed, duplicated, reordered, deleted and set as default in Settings.
- **Density.** Compact, comfortable or spacious.
- **Profile.** Your name drives "Assigned to Me"; your customer list drives "My Customers".

Keyboard: `/` focuses search, arrow keys move through rows, `Enter` opens an alert, `Esc` closes the panel.

## Project structure

```
shared/types.ts            Data contract between backend and frontend
server/
  index.ts, app.ts         Start-up and HTTP API (GET only)
  config.ts                Environment variables, validated
  logger.ts                Logging with credential masking
  jira/                    Jira integration: client, response validation, mapping, synchronisation
  demo/                    Sample data, in the same shape Jira returns
  services/alertStore.ts   Cache: TTL, single flight, stale data on failure, content version
src/
  config/                  Registries: columns, filters, quick filters, sections, widgets
  state/                   Preference stores: general, table layout, dashboard, views
  lib/                     Filter engine, statistics, storage adapter, router, formatting
  api/                     Calls to the backend and TanStack Query hooks
  components/              Interface: table, filters, dashboard, detail panel, settings
tests/                     Unit tests
```

### Adding things

| To add | Edit |
| --- | --- |
| A filter | one entry in `src/config/filterFields.ts` |
| A quick filter | one entry in `src/config/quickFilters.ts` |
| A column | `src/config/columns.ts`, plus its accessor and cell in `src/components/table/columns.tsx` |
| A dashboard widget | `src/config/widgets.ts`, plus its component in `src/components/dashboard/widgets.tsx` |
| A sidebar section | `src/config/sections.ts` |

### Storing preferences per user later

All preferences pass through one interface, `PreferenceStorage` in `src/lib/storage.ts`. Today the implementation is localStorage. For a shared deployment, write an implementation that loads and saves a user's preferences on a server and install it with `setPreferenceStorage()`; stores and components stay as they are.

## Security

- Read-only: the backend exposes only `GET` routes and the Jira client has no method that writes.
- Credentials exist only in the backend process. The browser talks only to `/api` on the local server.
- The server listens on `127.0.0.1` and rejects requests with an unexpected `Host` header.
- Logs contain paths, status codes, counts and durations. No headers, no response bodies, no alert content; strings that look like credentials are masked.
- Errors shown in the interface are fixed, safe messages, not Jira's raw response.
- The production build is served with a Content-Security-Policy that allows scripts and connections from the application itself only.

## Not included yet

- Write actions (acknowledge, close, assign, add note). The API supports them; they were left out on purpose.
- OAuth 2.0 sign-in and per-user preferences on a server.
- Names for user, schedule and escalation responders.
