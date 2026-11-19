import type { Alert } from '../../shared/types';

/**
 * One-click filters shown above the table. Exactly one is active at a time
 * ("All" means none) and it combines with the section and the other filters.
 * To add one, add an entry here.
 */
export interface QuickFilterContext {
  /** The user's name as it appears in the Assignee column (Settings → Profile). */
  me: string | null;
  myCustomers: ReadonlySet<string>;
}

export interface QuickFilter {
  id: string;
  label: string;
  description: string;
  test: (alert: Alert, ctx: QuickFilterContext) => boolean;
  /** Needs a profile value before it can work. */
  requires?: 'me' | 'myCustomers';
}

export const QUICK_FILTERS = [
  { id: 'critical', label: 'Critical', description: 'Priority P1', test: (a) => a.priority === 'P1' },
  { id: 'high', label: 'High', description: 'Priority P2', test: (a) => a.priority === 'P2' },
  {
    id: 'unacked',
    label: 'Unacknowledged',
    description: 'Open alerts nobody has acknowledged yet',
    test: (a) => a.status === 'open' && !a.acknowledged,
  },
  {
    id: 'mine',
    label: 'Assigned to Me',
    description: 'Alerts whose assignee is you',
    requires: 'me',
    test: (a, ctx) => ctx.me !== null && a.assignee !== null && a.assignee.toLowerCase() === ctx.me.toLowerCase(),
  },
  {
    id: 'multi',
    label: 'Multiple Customers',
    description: 'Alerts affecting two or more customers',
    test: (a) => a.customers.length > 1,
  },
  {
    id: 'myCustomers',
    label: 'My Customers',
    description: 'Alerts affecting a customer on your list',
    requires: 'myCustomers',
    test: (a, ctx) => a.customers.some((c) => ctx.myCustomers.has(c)),
  },
] as const satisfies readonly QuickFilter[];

export type QuickFilterId = (typeof QUICK_FILTERS)[number]['id'];

export function isQuickFilterId(value: unknown): value is QuickFilterId {
  return QUICK_FILTERS.some((q) => q.id === value);
}

export function quickFilterById(id: QuickFilterId | null): QuickFilter | null {
  return QUICK_FILTERS.find((q) => q.id === id) ?? null;
}
