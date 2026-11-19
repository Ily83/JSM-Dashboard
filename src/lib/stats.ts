import { PRIORITIES, type Alert, type Priority } from '../../shared/types';

/** Figures shown by the dashboard widgets, computed in one pass over the alerts. */
export interface Ranked {
  name: string;
  count: number;
  /** How many of them are P1. */
  critical: number;
}

export interface DashboardStats {
  active: number;
  open: number;
  acked: number;
  snoozed: number;
  critical: number;
  criticalUnacked: number;
  high: number;
  highUnacked: number;
  unassigned: number;
  unassignedUrgent: number;
  byPriority: Record<Priority, number>;
  customers: Ranked[];
  services: Ranked[];
  sources: Ranked[];
  /** Open, unacknowledged P1/P2 alerts, oldest first. */
  attention: Alert[];
}

function rank(map: Map<string, Ranked>): Ranked[] {
  return [...map.values()].sort((a, b) => b.count - a.count || b.critical - a.critical || a.name.localeCompare(b.name));
}

function bump(map: Map<string, Ranked>, name: string, critical: boolean): void {
  let entry = map.get(name);
  if (!entry) {
    entry = { name, count: 0, critical: 0 };
    map.set(name, entry);
  }
  entry.count += 1;
  if (critical) entry.critical += 1;
}

export function computeStats(alerts: readonly Alert[]): DashboardStats {
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  const customers = new Map<string, Ranked>();
  const services = new Map<string, Ranked>();
  const sources = new Map<string, Ranked>();
  const attention: Alert[] = [];
  const stats = { active: 0, open: 0, acked: 0, snoozed: 0, critical: 0, criticalUnacked: 0, high: 0, highUnacked: 0, unassigned: 0, unassignedUrgent: 0 };

  for (const alert of alerts) {
    if (alert.status === 'closed') continue;
    const p1 = alert.priority === 'P1';
    const p2 = alert.priority === 'P2';
    const waiting = alert.status === 'open' && !alert.acknowledged;
    stats.active += 1;
    stats[alert.status] += 1;
    byPriority[alert.priority] += 1;
    if (p1) {
      stats.critical += 1;
      if (waiting) stats.criticalUnacked += 1;
    }
    if (p2) {
      stats.high += 1;
      if (waiting) stats.highUnacked += 1;
    }
    if (!alert.assignee) {
      stats.unassigned += 1;
      if (p1 || p2) stats.unassignedUrgent += 1;
    }
    if ((p1 || p2) && waiting) attention.push(alert);
    for (const customer of alert.customers) bump(customers, customer, p1);
    if (alert.service) bump(services, alert.service, p1);
    bump(sources, alert.source, p1);
  }

  attention.sort((a, b) => a.createdAt - b.createdAt);
  return {
    ...stats,
    byPriority,
    customers: rank(customers),
    services: rank(services),
    sources: rank(sources),
    attention: attention.slice(0, 25),
  };
}
