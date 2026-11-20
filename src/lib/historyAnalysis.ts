import { DAY_MS, HISTORY_PAGE_SIZE, utcDate } from '../../shared/history';
import type { Alert, HistoryResponse } from '../../shared/types';

export const MAX_ANALYSIS_ALERTS_PER_MONTH = 500;

export interface HistoryMonth {
  key: string;
  from: string;
  to: string;
  alerts: Alert[];
  partial: boolean;
}

type FetchHistoryPage = (window: { from: string; to: string }, offset: number) => Promise<HistoryResponse>;

/**
 * Adds a page's alerts created in [start, end) to `alerts`. Returns true when
 * it had to drop one (outside the window, or already seen).
 */
function collectAlerts(page: HistoryResponse, start: number, end: number, alerts: Map<string, Alert>): boolean {
  let dropped = false;
  for (const alert of page.alerts) {
    if (alert.createdAt < start || alert.createdAt >= end || alerts.has(alert.id)) {
      dropped = true;
      continue;
    }
    alerts.set(alert.id, alert);
  }
  return dropped;
}

/** One calendar month from `start` (its first day, or the first day asked for), up to `to`. */
async function loadHistoryMonth(start: number, to: number, fetchPage: FetchHistoryPage): Promise<{ month: HistoryMonth; next: number }> {
  const date = new Date(start);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const window = { from: utcDate(start), to: utcDate(Math.min(next - DAY_MS, to)) };
  const alerts = new Map<string, Alert>();
  let partial = false;
  for (let offset = 0; offset < MAX_ANALYSIS_ALERTS_PER_MONTH; offset += HISTORY_PAGE_SIZE) {
    const page = await fetchPage(window, offset);
    if (collectAlerts(page, start, Math.min(next, to + DAY_MS), alerts)) partial = true;
    partial ||= page.truncated || page.skipped > 0;
    if (!page.hasNext) break;
    if (offset + HISTORY_PAGE_SIZE >= MAX_ANALYSIS_ALERTS_PER_MONTH) partial = true;
  }
  return { month: { ...window, key: window.from.slice(0, 7), alerts: [...alerts.values()], partial }, next };
}

export async function loadHistoryMonths(from: number, to: number, fetchPage: FetchHistoryPage): Promise<HistoryMonth[]> {
  const months: HistoryMonth[] = [];
  for (let start = from; start <= to;) {
    const { month, next } = await loadHistoryMonth(start, to, fetchPage);
    months.push(month);
    start = next;
  }
  return months;
}

export function filterHistoryMonths(months: readonly HistoryMonth[], customer: string, tag: string): HistoryMonth[] {
  return months.map((month) => ({
    ...month,
    alerts: month.alerts.filter((alert) => (!customer || alert.customers.includes(customer)) && (!tag || alert.tags.includes(tag))),
  }));
}
