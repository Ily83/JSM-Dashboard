import type { AlertDetail, AppMode, HistoryResponse } from '../../shared/types';

export interface HistoryPage {
  from: number;
  /** Exclusive end timestamp. */
  until: number;
  offset: number;
}

/** The alerts known after one synchronisation. */
export interface SourceSnapshot {
  alerts: Map<string, AlertDetail>;
  /** True when the source holds more alerts than the configured limits. */
  truncated: boolean;
  /** Alerts dropped because they failed validation. */
  skipped: number;
}

/**
 * Where alerts come from. Two implementations: DemoSource (sample data) and
 * JiraSource (Jira Service Management Operations API). Writes go through
 * AlertOperations (server/services/operations.ts), not through this interface.
 */
export interface AlertSource {
  readonly mode: AppMode;
  /** Returns the current set of alerts. `previous` enables incremental work. */
  sync(previous: SourceSnapshot | null): Promise<SourceSnapshot>;
  loadHistory(page: HistoryPage): Promise<HistoryResponse>;
  /** Loads description and extra properties for one alert. Null if it no longer exists. */
  loadDetail(id: string): Promise<AlertDetail | null>;
}
