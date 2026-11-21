import type { Alert } from '../../shared/types';
import { groupAlerts, rankGroups, type AlertGroup, type GroupMode } from './alertGroups';
import { filterHistoryMonths, type HistoryMonth } from './historyAnalysis';
import type { ResponseDimension } from './responseTimes';

/**
 * Breakdowns of the alerts loaded by the History analysis. All of them work
 * on the months already in memory, so switching breakdown sends no request.
 */

export const BREAKDOWNS = ['month', 'overview', 'daily', 'rankings', 'recurring', 'hotspots', 'customers', 'response'] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];
export const RANK_BY = ['source', 'team', 'tag'] as const;
export const GROUP_BY = ['status', 'priority'] as const;

export const HOTSPOT_DIMENSIONS = ['customer', 'service', 'group'] as const;
export type HotspotDimension = (typeof HOTSPOT_DIMENSIONS)[number];

/** Everything that defines an analysis besides its date range. Saved with an investigation. */
export interface AnalysisSettings {
  customer: string;
  tag: string;
  breakdown: Breakdown;
  /** Recurring alerts and alerts per customer: count P1 alerts only. */
  p1Only: boolean;
  dimension: HotspotDimension;
  /** Response times (MTTA, MTTR): rows per priority, customer or alert group. */
  responseBy: ResponseDimension;
  rankBy?: (typeof RANK_BY)[number];
  dayBy?: (typeof GROUP_BY)[number];
  source?: string;
  excludeSource?: string;
  excludeTag?: string;
  integration?: string;
  status?: Alert['status'];
  priority?: Alert['priority'];
  message?: string;
  excludeMessage?: string;
  propertyKey?: string;
  propertyValue?: string;
}

export const DEFAULT_ANALYSIS_SETTINGS = (): AnalysisSettings => ({
  customer: '',
  tag: '',
  breakdown: 'month',
  p1Only: false,
  dimension: 'customer',
  responseBy: 'priority',
});

export const isBreakdown = (value: unknown): value is Breakdown => (BREAKDOWNS as readonly unknown[]).includes(value);
export const isHotspotDimension = (value: unknown): value is HotspotDimension =>
  (HOTSPOT_DIMENSIONS as readonly unknown[]).includes(value);

/** One bar or row of a ranking, with the alerts it stands for (newest first). */
export interface RankedEntry {
  key: string;
  label: string;
  /** The ranked figure: alerts, or P1 alerts for hotspots. */
  count: number;
  p1: number;
  /** All alerts with this key, any priority. Equals `count` unless only P1 alerts are ranked. */
  total: number;
  alerts: Alert[];
}

const newestFirst = (a: Alert, b: Alert) => b.createdAt - a.createdAt || a.id.localeCompare(b.id);
const isP1 = (alert: Alert) => alert.priority === 'P1';

/** The alerts of all months that pass the customer and tag filters. */
export function analysisAlerts(months: readonly HistoryMonth[], customer: string, tag: string): Alert[] {
  const seen = new Set<string>();
  const out: Alert[] = [];
  for (const month of filterHistoryMonths(months, customer, tag)) {
    for (const alert of month.alerts) {
      if (seen.has(alert.id)) continue;
      seen.add(alert.id);
      out.push(alert);
    }
  }
  return out.sort(newestFirst);
}

/** Repeated alerts, most records first. With `p1Only`, only P1 alerts are grouped and counted. */
export function rankRecurring(alerts: readonly Alert[], p1Only: boolean, mode: GroupMode = 'alias'): AlertGroup[] {
  const input = p1Only ? alerts.filter(isP1) : alerts;
  return rankGroups(groupAlerts([...input].sort(newestFirst), mode));
}

function collect(alerts: readonly Alert[], keysOf: (alert: Alert) => readonly string[]): Map<string, Alert[]> {
  const map = new Map<string, Alert[]>();
  for (const alert of [...alerts].sort(newestFirst)) {
    for (const key of new Set(keysOf(alert))) {
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(alert);
    }
  }
  return map;
}

function byCount(a: RankedEntry, b: RankedEntry): number {
  return b.count - a.count || b.total - a.total || a.label.localeCompare(b.label);
}

/**
 * Alerts per customer. An alert affecting several customers counts once for
 * each of them, so the bars can add up to more than the number of alerts.
 */
export function rankCustomers(alerts: readonly Alert[], p1Only: boolean): { entries: RankedEntry[]; withoutCustomer: number } {
  const input = p1Only ? alerts.filter(isP1) : alerts;
  const entries = [...collect(input, (a) => a.customers)].map(([name, list]) => {
    const p1 = list.filter(isP1).length;
    return { key: name, label: name, count: list.length, p1, total: list.length, alerts: list };
  });
  entries.sort(byCount);
  return { entries, withoutCustomer: input.filter((a) => a.customers.length === 0).length };
}

/** Customers, services or alert groups ranked by their number of P1 alerts. */
export function rankHotspots(alerts: readonly Alert[], dimension: HotspotDimension, mode: GroupMode = 'alias'): RankedEntry[] {
  let entries: RankedEntry[];
  if (dimension === 'group') {
    entries = groupAlerts([...alerts].sort(newestFirst), mode).map((group) => ({
      key: group.key,
      label: group.label,
      count: group.p1,
      p1: group.p1,
      total: group.records,
      alerts: group.alerts.filter(isP1),
    }));
  } else {
    const keysOf = dimension === 'customer' ? (a: Alert) => a.customers : (a: Alert) => (a.service ? [a.service] : []);
    entries = [...collect(alerts, keysOf)].map(([name, list]) => {
      const p1Alerts = list.filter(isP1);
      return { key: name, label: name, count: p1Alerts.length, p1: p1Alerts.length, total: list.length, alerts: p1Alerts };
    });
  }
  return entries.filter((entry) => entry.count > 0).sort(byCount);
}
