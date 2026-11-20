import { PRIORITIES, type Alert } from '../../shared/types';
import { groupAlerts } from './alertGroups';

/**
 * Time to acknowledge (MTTA) and time to close (MTTR) for History.
 *
 *   to acknowledge  ackTime − createdAt
 *   to close        closeTime − createdAt
 *
 * Reported as median and 90th percentile, which say more than a mean on
 * skewed data. Alerts without the timestamp (never acknowledged, still
 * open) are left out of that figure and counted, so it is clear how much
 * the figure is based on.
 */

export const RESPONSE_DIMENSIONS = ['priority', 'customer', 'group'] as const;
export type ResponseDimension = (typeof RESPONSE_DIMENSIONS)[number];
export const isResponseDimension = (value: unknown): value is ResponseDimension =>
  (RESPONSE_DIMENSIONS as readonly unknown[]).includes(value);

export interface DurationStats {
  /** Alerts the figure is based on. */
  count: number;
  /** Alerts left out: no timestamp (or one before creation). */
  missing: number;
  median: number | null;
  p90: number | null;
}

export interface ResponseStats {
  alerts: number;
  ack: DurationStats;
  close: DurationStats;
}

export interface ResponseRow {
  key: string;
  label: string;
  stats: ResponseStats;
  alerts: Alert[];
}

/** Percentile with linear interpolation between ranks; `sorted` ascending. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function durations(alerts: readonly Alert[], end: (a: Alert) => number | null): DurationStats {
  const values: number[] = [];
  let missing = 0;
  for (const alert of alerts) {
    const at = end(alert);
    if (at === null || at < alert.createdAt || alert.createdAt <= 0) missing += 1;
    else values.push(at - alert.createdAt);
  }
  values.sort((a, b) => a - b);
  return { count: values.length, missing, median: percentile(values, 0.5), p90: percentile(values, 0.9) };
}

export function responseStats(alerts: readonly Alert[]): ResponseStats {
  return { alerts: alerts.length, ack: durations(alerts, (a) => a.ackTime), close: durations(alerts, (a) => a.closeTime) };
}

/**
 * Response times per priority (P1 first), per customer or per alert group
 * (most alerts first). An alert with several customers counts for each.
 */
export function responseBreakdown(alerts: readonly Alert[], dimension: ResponseDimension): ResponseRow[] {
  if (dimension === 'priority') {
    return PRIORITIES.map((p) => {
      const list = alerts.filter((a) => a.priority === p);
      return { key: p, label: p, stats: responseStats(list), alerts: list };
    }).filter((row) => row.alerts.length > 0);
  }
  let rows: ResponseRow[];
  if (dimension === 'group') {
    rows = groupAlerts(alerts).map((g) => ({ key: g.key, label: g.label, stats: responseStats(g.alerts), alerts: g.alerts }));
  } else {
    const byCustomer = new Map<string, Alert[]>();
    for (const alert of alerts) {
      for (const name of new Set(alert.customers)) {
        let list = byCustomer.get(name);
        if (!list) {
          list = [];
          byCustomer.set(name, list);
        }
        list.push(alert);
      }
    }
    rows = [...byCustomer].map(([name, list]) => ({ key: name, label: name, stats: responseStats(list), alerts: list }));
  }
  return rows.sort((a, b) => b.alerts.length - a.alerts.length || a.label.localeCompare(b.label));
}

/** "45s", "12m", "3h 05m", "2d 4h". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
