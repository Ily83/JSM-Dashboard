import { PRIORITIES, STATUSES, type Alert, type AlertStatus, type Priority } from '../../shared/types';

/**
 * Filter registry. Every filter the user can apply is one entry here; the
 * filter bar, the filter engine, saved views and the settings page are all
 * driven by this list. To add a filter, add an entry: nothing else changes.
 *
 * All filters are evaluated in the browser against the cached alert list.
 * The Jira list endpoint accepts a search query, but using it per filter
 * change would cost one or more API requests per click, and several fields
 * shown here (customer, service, updated date) do not exist as searchable
 * Jira fields at all. See README, "Filtering".
 */

/** Option value meaning "empty": no customer, no service, unassigned… */
export const NONE = '';

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  acked: 'Acked',
  snoozed: 'Snoozed',
  closed: 'Closed',
};

export const PRIORITY_NAME: Record<Priority, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Moderate',
  P4: 'Low',
  P5: 'Informational',
};

interface BaseField {
  id: string;
  label: string;
  /** Shown in the filter bar without opening "More". Users can change this in Settings. */
  pinnedByDefault: boolean;
  description?: string;
}

/** Pick one or more values; each can be included or excluded. */
export interface SetField extends BaseField {
  kind: 'set';
  get: (alert: Alert) => string | readonly string[] | null;
  /** True when an alert can carry several values (customers, tags, teams): enables "match all". */
  multi: boolean;
  /** Fixed list of options, in display order. Otherwise options are collected from the alerts. */
  options?: readonly string[];
  /** Label for the empty value, when the field can be empty. */
  noneLabel?: string;
  format?: (value: string) => string;
}

export interface DateField extends BaseField {
  kind: 'date';
  get: (alert: Alert) => number | null;
}

/** Free text, matched case-insensitively as "contains". */
export interface TextField extends BaseField {
  kind: 'text';
  get: (alert: Alert) => string;
  placeholder: string;
}

export type FilterField = SetField | DateField | TextField;

const teamCache = new WeakMap<Alert, string[]>();
export function teamsOf(alert: Alert): string[] {
  let teams = teamCache.get(alert);
  if (!teams) {
    teams = alert.responders.filter((r) => r.type === 'team').map((r) => r.name ?? r.id);
    teamCache.set(alert, teams);
  }
  return teams;
}

export const SET_FIELDS = [
  {
    id: 'priority',
    kind: 'set',
    label: 'Priority',
    pinnedByDefault: true,
    multi: false,
    options: PRIORITIES,
    get: (a) => a.priority,
    format: (v) => `${v} · ${PRIORITY_NAME[v as Priority] ?? ''}`,
  },
  {
    id: 'status',
    kind: 'set',
    label: 'Status',
    pinnedByDefault: true,
    multi: false,
    options: STATUSES,
    get: (a) => a.status,
    format: (v) => STATUS_LABEL[v as AlertStatus] ?? v,
  },
  {
    id: 'acknowledged',
    kind: 'set',
    label: 'Acknowledgement',
    pinnedByDefault: false,
    multi: false,
    options: ['no', 'yes'],
    get: (a) => (a.acknowledged ? 'yes' : 'no'),
    format: (v) => (v === 'yes' ? 'Acknowledged' : 'Unacknowledged'),
  },
  {
    id: 'customer',
    kind: 'set',
    label: 'Customer',
    pinnedByDefault: true,
    multi: true,
    noneLabel: 'No customer',
    get: (a) => a.customers,
  },
  {
    id: 'tag',
    kind: 'set',
    label: 'Tag',
    pinnedByDefault: false,
    multi: true,
    noneLabel: 'No tags',
    get: (a) => a.tags,
    description: 'Tags other than the ones recognised as customer or service.',
  },
  {
    id: 'service',
    kind: 'set',
    label: 'Service',
    pinnedByDefault: true,
    multi: false,
    noneLabel: 'No service',
    get: (a) => a.service,
  },
  {
    id: 'team',
    kind: 'set',
    label: 'Team',
    pinnedByDefault: false,
    multi: true,
    noneLabel: 'No team',
    get: teamsOf,
    description: 'Responder teams of the alert.',
  },
  {
    id: 'assignee',
    kind: 'set',
    label: 'Assignee',
    pinnedByDefault: true,
    multi: false,
    noneLabel: 'Unassigned',
    get: (a) => a.assignee,
  },
  {
    id: 'source',
    kind: 'set',
    label: 'Source',
    pinnedByDefault: true,
    multi: false,
    get: (a) => a.source,
    description: 'Integration name, or the raw source when the alert has no integration.',
  },
  {
    id: 'integration',
    kind: 'set',
    label: 'Integration type',
    pinnedByDefault: false,
    multi: false,
    noneLabel: 'No integration',
    get: (a) => a.integrationType,
  },
] as const satisfies readonly SetField[];

export const DATE_FIELDS = [
  { id: 'created', kind: 'date', label: 'Created', pinnedByDefault: true, get: (a) => a.createdAt },
  { id: 'updated', kind: 'date', label: 'Updated', pinnedByDefault: false, get: (a) => a.updatedAt },
] as const satisfies readonly DateField[];

export const TEXT_FIELDS = [
  {
    id: 'identifier',
    kind: 'text',
    label: 'Alert ID',
    pinnedByDefault: false,
    placeholder: 'Tiny ID, alert ID or alias',
    get: (a) => `${a.tinyId ?? ''}\n#${a.tinyId ?? ''}\n${a.id}\n${a.alias ?? ''}`.toLowerCase(),
    description: 'Matches the short number, the full alert id or the alias.',
  },
] as const satisfies readonly TextField[];

export type SetFieldId = (typeof SET_FIELDS)[number]['id'];
export type DateFieldId = (typeof DATE_FIELDS)[number]['id'];
export type TextFieldId = (typeof TEXT_FIELDS)[number]['id'];
export type FilterFieldId = SetFieldId | DateFieldId | TextFieldId;

/** Display order in the filter bar and in Settings. */
const ORDER: FilterFieldId[] = [
  'priority',
  'status',
  'customer',
  'service',
  'assignee',
  'source',
  'created',
  'acknowledged',
  'tag',
  'team',
  'integration',
  'updated',
  'identifier',
];

export const FIELD_BY_ID = Object.fromEntries(
  [...SET_FIELDS, ...DATE_FIELDS, ...TEXT_FIELDS].map((field) => [field.id, field]),
) as Record<FilterFieldId, FilterField>;

export const FILTER_FIELDS: readonly FilterField[] = ORDER.map((id) => FIELD_BY_ID[id]);

export function isFilterFieldId(value: unknown): value is FilterFieldId {
  return typeof value === 'string' && value in FIELD_BY_ID;
}

export function formatValue(field: SetField, value: string): string {
  if (value === NONE) return field.noneLabel ?? 'None';
  return field.format ? field.format(value) : value;
}

export type DatePreset = 'any' | '1h' | '4h' | '24h' | '7d' | '30d' | 'custom';

export const DATE_PRESETS: Array<{ id: DatePreset; label: string; ms: number | null }> = [
  { id: 'any', label: 'Any time', ms: null },
  { id: '1h', label: 'Last hour', ms: 3_600_000 },
  { id: '4h', label: 'Last 4 hours', ms: 4 * 3_600_000 },
  { id: '24h', label: 'Last 24 hours', ms: 24 * 3_600_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 3_600_000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 24 * 3_600_000 },
  { id: 'custom', label: 'Custom range', ms: null },
];
