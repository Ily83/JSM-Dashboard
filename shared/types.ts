/**
 * Data contract between the backend and the frontend.
 *
 * The backend normalises Jira Service Management Operations alerts into this
 * shape, so the UI never depends on the raw Jira response.
 */

import type { WriteCapabilities } from './actions';

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Normalised status. Jira reports `status` (open, acked, resolved, snoozed,
 * closed) plus the booleans `acknowledged` and `snoozed`; the mapper folds
 * them into one value.
 */
export const STATUSES = ['open', 'acked', 'snoozed', 'closed'] as const;
export type AlertStatus = (typeof STATUSES)[number];

export type ResponderType = 'team' | 'user' | 'escalation' | 'schedule' | 'unknown';

export interface Responder {
  id: string;
  type: ResponderType;
  /** Resolved for teams (List teams endpoint). Jira returns only ids on alerts. */
  name?: string;
}

/** One row of the alert table. Kept small: no description, no extra properties. */
export interface Alert {
  id: string;
  tinyId: string | null;
  alias: string | null;
  summary: string;
  priority: Priority;
  status: AlertStatus;
  /** Status string exactly as Jira returned it. */
  rawStatus: string | null;
  /** Jira's `acknowledged` flag. Independent of `status`: a closed alert may or may not have been acknowledged. */
  acknowledged: boolean;
  /** Customers derived from tags / extra properties (see server/jira/mapper.ts). */
  customers: string[];
  /** Tags that were not consumed as a customer or service. */
  tags: string[];
  service: string | null;
  entity: string | null;
  /** Alert owner display name. */
  assignee: string | null;
  responders: Responder[];
  /** Label shown in the "Alert source" column: integration name, else source. */
  source: string;
  rawSource: string | null;
  integrationName: string | null;
  integrationType: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  lastOccurredAt: number | null;
  ackTime: number | null;
  closeTime: number | null;
  snoozedUntil: number | null;
  /** Number of de-duplicated occurrences. */
  count: number;
  /** Link to the alert in Jira; null in demo mode. */
  url: string | null;
}

/** Everything known about one alert, shown in the detail panel. */
export interface AlertDetail extends Alert {
  description: string | null;
  /** Tags exactly as Jira returned them. */
  rawTags: string[];
  extraProperties: Record<string, string>;
  actions: string[];
  seen: boolean | null;
  /**
   * True when description and extra properties come from a response that
   * included them. False means only list-level data was available.
   */
  detailLoaded: boolean;
  /** Set when the per-alert request failed and list-level data is shown. */
  detailError?: string;
}

export type AppMode = 'demo' | 'live';

export interface SyncMeta {
  mode: AppMode;
  /** Last successful synchronisation with the data source, epoch ms. */
  lastSyncAt: number | null;
  lastAttemptAt: number | null;
  /** True when the last attempt failed and cached data is being served. */
  stale: boolean;
  /** Sanitised, user-readable error of the last failed attempt. */
  error: string | null;
  total: number;
  /** True when Jira holds more alerts than the configured limits allow. */
  truncated: boolean;
  /** Alerts dropped because they failed validation. */
  skipped: number;
  lastSyncDurationMs: number | null;
  /** When set, the backend will not call Jira before this time (rate limit). */
  retryAt: number | null;
}

export interface AlertsResponse {
  /** Content version of the alert list. */
  version: string;
  /** True when the client already holds this version; `alerts` is then empty. */
  unchanged: boolean;
  alerts: Alert[];
  meta: SyncMeta;
}

export interface HistoryResponse {
  alerts: Alert[];
  hasNext: boolean;
  /** The date window has more results than the pagination limit allows. */
  truncated: boolean;
  skipped: number;
}

export interface ExtractionRules {
  customerTagPrefixes: string[];
  customerCompanyTagPrefixes: string[];
  customerPropertyKeys: string[];
  serviceTagPrefixes: string[];
  servicePropertyKeys: string[];
  serviceFallbackToEntity: boolean;
  /** Rules in CUSTOMER_MAP_FILE (entity -> customers), 0 when none. */
  customerMapRules?: number;
}

export interface StatusResponse {
  mode: AppMode;
  /** True when no write action is enabled. */
  readOnly: boolean;
  /** Write actions the configuration allows (JIRA_WRITE_ACTIONS; always all in demo mode). */
  writes: WriteCapabilities;
  /** Jira site host name, live mode only. Never includes credentials. */
  site: string | null;
  defaultRefreshSeconds: number;
  cacheTtlSeconds: number;
  limits: { maxOpenAlerts: number; maxClosedAlerts: number; closedLookbackHours: number };
  extraction: ExtractionRules;
  warnings: string[];
  meta: SyncMeta;
}

export interface ApiError {
  error: string;
}
