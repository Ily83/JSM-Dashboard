import type { Alert } from '../../shared/types';

/**
 * Customer scope: one selection of customers that limits the KPIs, widgets,
 * section and quick-filter counts and the table together. It is separate
 * from the view filters, so switching customers never changes a saved view.
 * An alert is in scope when it affects at least one selected customer.
 */

export function scopeAlerts<T extends Pick<Alert, 'customers'>>(alerts: T[], scope: readonly string[]): T[] {
  if (scope.length === 0) return alerts;
  const wanted = new Set(scope.map((name) => name.toLowerCase()));
  return alerts.filter((alert) => alert.customers.some((name) => wanted.has(name.toLowerCase())));
}

export interface CustomerOption {
  name: string;
  /** Alerts that are not closed. */
  active: number;
  total: number;
}

/** Every customer in the loaded alerts, plus selected ones that currently have none, sorted by name. */
export function customerOptions(alerts: readonly Pick<Alert, 'customers' | 'status'>[], scope: readonly string[]): CustomerOption[] {
  const byKey = new Map<string, CustomerOption>();
  for (const alert of alerts) {
    for (const name of alert.customers) {
      const key = name.toLowerCase();
      let option = byKey.get(key);
      if (!option) {
        option = { name, active: 0, total: 0 };
        byKey.set(key, option);
      }
      option.total += 1;
      if (alert.status !== 'closed') option.active += 1;
    }
  }
  for (const name of scope) {
    if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), { name, active: 0, total: 0 });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function isInScope(name: string, scope: readonly string[]): boolean {
  const key = name.toLowerCase();
  return scope.some((item) => item.toLowerCase() === key);
}

/** Adds or removes one customer, keeping the existing spelling of the others. */
export function toggleScope(scope: readonly string[], name: string): string[] {
  return isInScope(name, scope) ? scope.filter((item) => item.toLowerCase() !== name.toLowerCase()) : [...scope, name];
}
