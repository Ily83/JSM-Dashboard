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

export async function loadHistoryMonths(
  from: number,
  to: number,
  fetchPage: (window: { from: string; to: string }, offset: number) => Promise<HistoryResponse>,
): Promise<HistoryMonth[]> {
  const months: HistoryMonth[] = [];
  for (let start = from; start <= to;) {
    const date = new Date(start);
    const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const window = { from: utcDate(start), to: utcDate(Math.min(next - DAY_MS, to)) };
    const alerts = new Map<string, Alert>();
    let partial = false;
    for (let offset = 0; offset < MAX_ANALYSIS_ALERTS_PER_MONTH; offset += HISTORY_PAGE_SIZE) {
      const page = await fetchPage(window, offset);
      for (const alert of page.alerts) {
        if (alert.createdAt < start || alert.createdAt >= Math.min(next, to + DAY_MS) || alerts.has(alert.id)) {
          partial = true;
          continue;
        }
        alerts.set(alert.id, alert);
      }
      partial ||= page.truncated || page.skipped > 0;
      if (!page.hasNext) break;
      if (offset + HISTORY_PAGE_SIZE >= MAX_ANALYSIS_ALERTS_PER_MONTH) partial = true;
    }
    months.push({ ...window, key: window.from.slice(0, 7), alerts: [...alerts.values()], partial });
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
