import type { HistoryMonth } from '../../shared/historyAnalysis';
import { parseUtcDate } from '../../shared/history';

export type { HistoryMonth } from '../../shared/historyAnalysis';

export function filterHistoryMonths(months: readonly HistoryMonth[], customer: string, tag: string): HistoryMonth[] {
  return months.map((month) => ({
    ...month,
    alerts: month.alerts.filter((alert) => (!customer || alert.customers.includes(customer)) && (!tag || alert.tags.includes(tag))),
  }));
}

/*
 * History dates: English like the rest of the interface, always in UTC, and
 * one style for ranges, days and times ("Nov 1 – 30, 2025", "Nov 20, 2025, 14:03").
 */
const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const dayTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Nov 20, 2025". */
export function formatUtcDay(timestamp: number): string {
  return day.format(timestamp);
}

/** "Nov 20, 2025, 14:03". */
export function formatUtcDayTime(timestamp: number): string {
  return dayTime.format(timestamp);
}

/** Month labels of the histogram: "Nov 25", and "November 2025" for screen readers. */
export function formatUtcMonth(date: string): { short: string; long: string } {
  const timestamp = parseUtcDate(date) ?? 0;
  return { short: monthShort.format(timestamp), long: monthLong.format(timestamp) };
}

/** Inclusive UTC dates (YYYY-MM-DD) as one range: "Nov 1 – 30, 2025", "Nov 20, 2025 – Nov 20, 2026". */
export function formatUtcRange(from: string, to: string): string {
  const start = parseUtcDate(from);
  const end = parseUtcDate(to);
  if (start === null || end === null) return `${from} – ${to}`;
  if (start > end) return `${day.format(start)} – ${day.format(end)}`;
  return day.formatRange(start, end);
}
