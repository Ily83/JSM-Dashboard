import { PRIORITIES, type Alert, type Priority } from '../../shared/types';
import { teamsOf } from '../config/filterFields';
import { groupAlerts, groupSummaryAlert, type AlertGroup } from './alertGroups';

/**
 * The rows of the alert table, built from the sorted alerts:
 *
 *   lanes          optional split by customer, service or team; an alert
 *                  with several customers (or teams) appears in each lane
 *   group repeats  optional collapse of repeated alerts (src/lib/alertGroups.ts),
 *                  applied inside each lane
 *
 * Alerts keep the table's sort order inside each lane and group. Lanes are
 * ordered by their most urgent alert, then size, then name; "none" is last.
 */

export const LANE_FIELDS = ['off', 'customer', 'service', 'team'] as const;
export type LaneBy = (typeof LANE_FIELDS)[number];

export const LANE_LABEL: Record<LaneBy, string> = { off: 'No lanes', customer: 'Customer', service: 'Service', team: 'Team' };
const NONE_LABEL: Record<Exclude<LaneBy, 'off'>, string> = { customer: 'No customer', service: 'No service', team: 'No team' };

export type TableItem =
  | {
      kind: 'lane';
      key: string;
      name: string;
      isNone: boolean;
      /** Alerts in this lane, in table order. */
      alerts: Alert[];
      /** Alerts of this lane that also appear in other lanes. */
      shared: number;
      p1: number;
      priority: Priority;
      collapsed: boolean;
    }
  | {
      kind: 'alert';
      alert: Alert;
      /** Member of an expanded group. */
      child: boolean;
      lane: string | null;
      /** Names of the other lanes this alert appears in, comma-separated; '' when none. */
      alsoIn: string;
    }
  | { kind: 'group'; key: string; group: AlertGroup; summary: Alert; expanded: boolean; lane: string | null };

export interface BuildOptions {
  laneBy: LaneBy;
  groupRepeats: boolean;
  /** Keys of expanded groups (TableItem 'group' key). */
  expanded: ReadonlySet<string>;
  /** Keys of collapsed lanes. */
  collapsedLanes: ReadonlySet<string>;
}

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i])) as Record<Priority, number>;

export function laneValues(alert: Alert, laneBy: Exclude<LaneBy, 'off'>): string[] {
  if (laneBy === 'customer') return alert.customers;
  if (laneBy === 'service') return alert.service ? [alert.service] : [];
  return teamsOf(alert);
}

/** Group key, unique across lanes. */
export function groupItemKey(lane: string | null, groupKey: string): string {
  return lane === null ? groupKey : `${lane}\u0000${groupKey}`;
}

function rowsFor(alerts: Alert[], lane: string | null, options: BuildOptions, alsoIn: (alert: Alert) => string, out: TableItem[]): void {
  if (!options.groupRepeats) {
    for (const alert of alerts) out.push({ kind: 'alert', alert, child: false, lane, alsoIn: alsoIn(alert) });
    return;
  }
  for (const group of groupAlerts(alerts)) {
    if (group.records === 1) {
      const alert = group.alerts[0];
      out.push({ kind: 'alert', alert, child: false, lane, alsoIn: alsoIn(alert) });
      continue;
    }
    const key = groupItemKey(lane, group.key);
    const expanded = options.expanded.has(key);
    out.push({ kind: 'group', key, group, summary: groupSummaryAlert(group), expanded, lane });
    if (expanded) for (const alert of group.alerts) out.push({ kind: 'alert', alert, child: true, lane, alsoIn: alsoIn(alert) });
  }
}

export function buildTableItems(sorted: readonly Alert[], options: BuildOptions): TableItem[] {
  const out: TableItem[] = [];
  if (options.laneBy === 'off') {
    rowsFor([...sorted], null, options, () => '', out);
    return out;
  }
  const laneBy = options.laneBy;
  const NONE_KEY = '\u0000none';
  const lanes = new Map<string, { name: string; alerts: Alert[] }>();
  for (const alert of sorted) {
    const values = laneValues(alert, laneBy);
    if (values.length === 0) {
      let lane = lanes.get(NONE_KEY);
      if (!lane) {
        lane = { name: NONE_LABEL[laneBy], alerts: [] };
        lanes.set(NONE_KEY, lane);
      }
      lane.alerts.push(alert);
      continue;
    }
    for (const value of new Set(values)) {
      let lane = lanes.get(value);
      if (!lane) {
        lane = { name: value, alerts: [] };
        lanes.set(value, lane);
      }
      lane.alerts.push(alert);
    }
  }

  const summaries = [...lanes].map(([key, lane]) => {
    let priority: Priority = 'P5';
    let p1 = 0;
    let shared = 0;
    for (const alert of lane.alerts) {
      if (PRIORITY_RANK[alert.priority] < PRIORITY_RANK[priority]) priority = alert.priority;
      if (alert.priority === 'P1') p1 += 1;
      if (key !== NONE_KEY && new Set(laneValues(alert, laneBy)).size > 1) shared += 1;
    }
    return { key, name: lane.name, alerts: lane.alerts, priority, p1, shared, isNone: key === NONE_KEY };
  });
  summaries.sort(
    (a, b) =>
      Number(a.isNone) - Number(b.isNone) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.p1 - a.p1 ||
      b.alerts.length - a.alerts.length ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  for (const lane of summaries) {
    const collapsed = options.collapsedLanes.has(lane.key);
    out.push({ kind: 'lane', ...lane, collapsed });
    if (collapsed) continue;
    const alsoIn = (alert: Alert) => {
      if (lane.isNone) return '';
      const others = [...new Set(laneValues(alert, laneBy))].filter((v) => v !== lane.key);
      return others.join(', ');
    };
    rowsFor(lane.alerts, lane.key, options, alsoIn, out);
  }
  return out;
}

/** All alerts an item stands for: one alert, a group, or a lane. */
export function alertsOfItem(item: TableItem): Alert[] {
  if (item.kind === 'alert') return [item.alert];
  if (item.kind === 'group') return item.group.alerts;
  return item.alerts;
}

/** A React key that is unique even when an alert appears in several lanes. */
export function itemKey(item: TableItem): string {
  if (item.kind === 'lane') return `lane:${item.key}`;
  if (item.kind === 'group') return `group:${item.key}`;
  return item.lane === null ? item.alert.id : `${item.lane}\u0000${item.alert.id}`;
}
