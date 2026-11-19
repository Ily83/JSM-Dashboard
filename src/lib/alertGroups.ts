import { PRIORITIES, type Alert, type AlertStatus, type Priority } from '../../shared/types';

/**
 * Grouping rules for repeated alerts, shared by the History analysis
 * ("Recurring alerts") and the live table ("Group repeats").
 *
 * An alert belongs to a group by its Jira alias, the key Jira itself uses to
 * de-duplicate alerts. Alerts without a usable alias are grouped by source
 * plus a normalised summary, in which numbers, ids and hashes are replaced by
 * "#" so that "Disk 91% on vm-12" and "Disk 95% on vm-14" fall together.
 *
 * Two counts are kept apart on purpose:
 *   records      distinct alert records in Jira
 *   occurrences  Jira's de-duplication count summed over those records
 */

export type GroupMode = 'alias' | 'summary';

export interface AlertGroup {
  key: string;
  /** What formed the group: the alias, or source + normalised summary. */
  basis: 'alias' | 'summary';
  /** Summary of the newest alert in the group. */
  label: string;
  source: string;
  /** Newest first. */
  alerts: Alert[];
  records: number;
  occurrences: number;
  p1: number;
  /** Highest priority in the group. */
  priority: Priority;
  /** Union of affected customers, sorted. */
  customers: string[];
  firstCreatedAt: number;
  lastCreatedAt: number;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
// Hex tokens of six or more characters that contain a digit: hashes, ids.
const HEX_ID = /\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/g;
const NUMBER = /\d+(?:[.,:]\d+)*/g;

export function normaliseSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(UUID, '#')
    .replace(HEX_ID, '#')
    .replace(NUMBER, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An alias that only repeats the alert's own id identifies nothing. */
function usableAlias(alert: Alert): string | null {
  const alias = alert.alias?.trim();
  if (!alias || alias === alert.id || alias === alert.tinyId) return null;
  return alias;
}

export function groupKey(alert: Alert, mode: GroupMode = 'alias'): { key: string; basis: AlertGroup['basis'] } {
  const alias = mode === 'alias' ? usableAlias(alert) : null;
  if (alias) return { key: `alias:${alias}`, basis: 'alias' };
  return { key: `summary:${alert.source.toLowerCase()}|${normaliseSummary(alert.summary)}`, basis: 'summary' };
}

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i])) as Record<Priority, number>;

/**
 * Groups alerts, keeping the order in which each group is first met. Pass a
 * sorted list to get groups in that order; use rankGroups() to rank them.
 */
export function groupAlerts(alerts: readonly Alert[], mode: GroupMode = 'alias'): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const { key, basis } = groupKey(alert, mode);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        basis,
        label: alert.summary,
        source: alert.source,
        alerts: [],
        records: 0,
        occurrences: 0,
        p1: 0,
        priority: alert.priority,
        customers: [],
        firstCreatedAt: alert.createdAt,
        lastCreatedAt: alert.createdAt,
      };
      groups.set(key, group);
    }
    group.alerts.push(alert);
    group.records += 1;
    group.occurrences += alert.count;
    if (alert.priority === 'P1') group.p1 += 1;
    if (PRIORITY_RANK[alert.priority] < PRIORITY_RANK[group.priority]) group.priority = alert.priority;
    if (alert.createdAt > group.lastCreatedAt) {
      group.lastCreatedAt = alert.createdAt;
      group.label = alert.summary;
    }
    if (alert.createdAt < group.firstCreatedAt) group.firstCreatedAt = alert.createdAt;
  }
  for (const group of groups.values()) {
    group.customers = [...new Set(group.alerts.flatMap((a) => a.customers))].sort((a, b) => a.localeCompare(b));
  }
  return [...groups.values()];
}

/** Most records first, then most occurrences, then most recent. */
export function rankGroups(groups: readonly AlertGroup[]): AlertGroup[] {
  return [...groups].sort(
    (a, b) => b.records - a.records || b.occurrences - a.occurrences || b.lastCreatedAt - a.lastCreatedAt || a.key.localeCompare(b.key),
  );
}

const STATUS_RANK: Record<AlertStatus, number> = { open: 0, acked: 1, snoozed: 2, closed: 3 };

/**
 * One row that stands for a whole group, so a group header can be drawn with
 * the normal cell renderers: highest priority, most active status, union of
 * customers and tags, newest times, total occurrences.
 */
export function groupSummaryAlert(group: AlertGroup): Alert {
  const newest = group.alerts.reduce((a, b) => (b.createdAt > a.createdAt ? b : a), group.alerts[0]);
  const status = group.alerts.reduce<AlertStatus>((s, a) => (STATUS_RANK[a.status] < STATUS_RANK[s] ? a.status : s), 'closed');
  const assignees = new Set(group.alerts.map((a) => a.assignee));
  return {
    ...newest,
    id: `group:${group.key}`,
    tinyId: null,
    priority: group.priority,
    status,
    acknowledged: group.alerts.every((a) => a.acknowledged),
    customers: group.customers,
    tags: [...new Set(group.alerts.flatMap((a) => a.tags))],
    assignee: assignees.size === 1 ? newest.assignee : null,
    updatedAt: Math.max(...group.alerts.map((a) => a.updatedAt)),
    count: group.occurrences,
    url: null,
  };
}
