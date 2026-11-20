import type { HistoryMonth } from '../../shared/historyAnalysis';

export type { HistoryMonth } from '../../shared/historyAnalysis';

export function filterHistoryMonths(months: readonly HistoryMonth[], customer: string, tag: string): HistoryMonth[] {
  return months.map((month) => ({
    ...month,
    alerts: month.alerts.filter((alert) => (!customer || alert.customers.includes(customer)) && (!tag || alert.tags.includes(tag))),
  }));
}
