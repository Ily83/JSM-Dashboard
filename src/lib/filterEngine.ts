import type { Alert } from '../../shared/types';
import {
  DATE_FIELDS,
  DATE_PRESETS,
  NONE,
  SET_FIELDS,
  STATUS_LABEL,
  TEXT_FIELDS,
  teamsOf,
  type DateFieldId,
  type DatePreset,
  type FilterFieldId,
  type SetField,
  type SetFieldId,
  type TextFieldId,
} from '../config/filterFields';
import { quickFilterById, type QuickFilterContext, type QuickFilterId } from '../config/quickFilters';
import { inSection, type SectionDef } from '../config/sections';
import { compileQuery } from './query';

/**
 * Filter state and evaluation. Pure functions, no React, no storage: the same
 * code can run in a worker or on a server if the data set ever outgrows the
 * browser.
 *
 * Semantics
 *   - Different filters are combined with AND.
 *   - Within one filter, included values are combined with OR ("any of"),
 *     or with AND ("all of") for fields that hold several values per alert.
 *   - Excluded values always remove the alert ("is not").
 */

export interface SetCondition {
  include: string[];
  exclude: string[];
  /** Only meaningful for multi-value fields. */
  match: 'any' | 'all';
}

export interface DateCondition {
  preset: DatePreset;
  /** `datetime-local` values, used when preset is "custom". */
  from: string;
  to: string;
}

export interface Filters {
  set: Partial<Record<SetFieldId, SetCondition>>;
  date: Partial<Record<DateFieldId, DateCondition>>;
  text: Partial<Record<TextFieldId, string>>;
}

export const EMPTY_FILTERS: Filters = { set: {}, date: {}, text: {} };
export const EMPTY_SET: SetCondition = { include: [], exclude: [], match: 'any' };
export const EMPTY_DATE: DateCondition = { preset: 'any', from: '', to: '' };

export function isSetActive(c: SetCondition | undefined): c is SetCondition {
  return c !== undefined && (c.include.length > 0 || c.exclude.length > 0);
}

export function isDateActive(c: DateCondition | undefined): c is DateCondition {
  if (!c || c.preset === 'any') return false;
  return c.preset !== 'custom' || c.from !== '' || c.to !== '';
}

export function isTextActive(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/** Ids of the filters that currently restrict the list. */
export function activeFields(filters: Filters): FilterFieldId[] {
  return [
    ...SET_FIELDS.filter((f) => isSetActive(filters.set[f.id])).map((f) => f.id),
    ...DATE_FIELDS.filter((f) => isDateActive(filters.date[f.id])).map((f) => f.id),
    ...TEXT_FIELDS.filter((f) => isTextActive(filters.text[f.id])).map((f) => f.id),
  ];
}

/** Returns new filters with one condition replaced. Inactive conditions are dropped, so equal filters compare equal. */
export function withSet(filters: Filters, id: SetFieldId, condition: SetCondition): Filters {
  const set = { ...filters.set };
  if (isSetActive(condition)) set[id] = condition;
  else delete set[id];
  return { ...filters, set };
}

export function withDate(filters: Filters, id: DateFieldId, condition: DateCondition): Filters {
  const date = { ...filters.date };
  // A custom range without bounds is kept while the user is still typing it.
  if (condition.preset !== 'any') date[id] = condition;
  else delete date[id];
  return { ...filters, date };
}

export function withText(filters: Filters, id: TextFieldId, value: string): Filters {
  const text = { ...filters.text };
  if (value !== '') text[id] = value;
  else delete text[id];
  return { ...filters, text };
}

export function withoutField(filters: Filters, id: FilterFieldId): Filters {
  const next: Filters = { set: { ...filters.set }, date: { ...filters.date }, text: { ...filters.text } };
  delete next.set[id as SetFieldId];
  delete next.date[id as DateFieldId];
  delete next.text[id as TextFieldId];
  return next;
}

function dateRange(condition: DateCondition, now: number): [number, number] | null {
  if (condition.preset === 'custom') {
    const from = condition.from ? Date.parse(condition.from) : NaN;
    const to = condition.to ? Date.parse(condition.to) : NaN;
    if (Number.isNaN(from) && Number.isNaN(to)) return null;
    return [Number.isNaN(from) ? -Infinity : from, Number.isNaN(to) ? Infinity : to];
  }
  const preset = DATE_PRESETS.find((p) => p.id === condition.preset);
  return preset?.ms ? [now - preset.ms, Infinity] : null;
}

type Predicate = (alert: Alert) => boolean;

function setPredicate(field: SetField, condition: SetCondition, allowed: readonly string[] | undefined): Predicate | null {
  // A value the current section does not allow is ignored instead of emptying the table.
  const includeValues = allowed ? condition.include.filter((v) => allowed.includes(v)) : condition.include;
  const include = includeValues.length > 0 ? new Set(includeValues) : null;
  const exclude = condition.exclude.length > 0 ? new Set(condition.exclude) : null;
  if (!include && !exclude) return null;
  const all = field.multi && condition.match === 'all';
  const get = field.get;

  return (alert) => {
    const raw = get(alert);
    if (typeof raw === 'string' || raw === null) {
      const value = raw ?? NONE;
      if (exclude?.has(value)) return false;
      return include ? include.has(value) : true;
    }
    if (raw.length === 0) {
      if (exclude?.has(NONE)) return false;
      return include ? include.has(NONE) && (!all || include.size === 1) : true;
    }
    if (exclude) for (const value of raw) if (exclude.has(value)) return false;
    if (!include) return true;
    if (all) {
      for (const wanted of include) if (!raw.includes(wanted)) return false;
      return true;
    }
    for (const value of raw) if (include.has(value)) return true;
    return false;
  };
}

/** Lower-cased text of everything the global search looks at, built once per alert. */
const searchIndex = new WeakMap<Alert, string>();
function searchText(alert: Alert): string {
  let text = searchIndex.get(alert);
  if (text === undefined) {
    text = [
      alert.summary,
      alert.priority,
      STATUS_LABEL[alert.status],
      alert.customers.join(' '),
      alert.tags.join(' '),
      alert.service,
      alert.entity,
      alert.assignee,
      teamsOf(alert).join(' '),
      alert.source,
      alert.integrationType,
      alert.alias,
      alert.tinyId ? `#${alert.tinyId}` : '',
      alert.id,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    searchIndex.set(alert, text);
  }
  return text;
}

export interface ViewQuery {
  section: SectionDef;
  quick: QuickFilterId | null;
  filters: Filters;
  search: string;
  profile: QuickFilterContext;
  now: number;
}

/** Applies section, quick filter, filters and search in a single pass. */
export function filterAlerts(alerts: readonly Alert[], query: ViewQuery): Alert[] {
  const { section, filters, profile } = query;
  const predicates: Predicate[] = [];

  for (const field of SET_FIELDS) {
    const condition = filters.set[field.id];
    if (!isSetActive(condition)) continue;
    const allowed = field.id === 'priority' ? section.priority : field.id === 'status' ? section.status : undefined;
    const predicate = setPredicate(field, condition, allowed);
    if (predicate) predicates.push(predicate);
  }
  for (const field of DATE_FIELDS) {
    const condition = filters.date[field.id];
    const range = isDateActive(condition) ? dateRange(condition, query.now) : null;
    if (!range) continue;
    const [from, to] = range;
    const get = field.get;
    predicates.push((alert) => {
      const time = get(alert);
      return time !== null && time >= from && time <= to;
    });
  }
  for (const field of TEXT_FIELDS) {
    const value = filters.text[field.id];
    if (!isTextActive(value)) continue;
    const text = value.trim().toLowerCase();
    const needle = field.id === 'identifier' ? text.replace(/^#/, '') : text;
    const get = field.get;
    predicates.push((alert) => get(alert).toLowerCase().includes(needle));
  }
  const quick = quickFilterById(query.quick);
  if (quick) predicates.push((alert) => quick.test(alert, profile));
  // Plain words or the query language (src/lib/query.ts), compiled once.
  const search = compileQuery(query.search, { now: query.now, searchText });
  if (search.predicate) predicates.push(search.predicate);

  const out: Alert[] = [];
  outer: for (const alert of alerts) {
    if (!inSection(alert, section)) continue;
    for (const predicate of predicates) if (!predicate(alert)) continue outer;
    out.push(alert);
  }
  return out;
}

export interface FacetOption {
  value: string;
  count: number;
}
export type Facets = Record<SetFieldId, FacetOption[]>;

/** Available values per filter with the number of alerts in the section. */
export function buildFacets(alerts: readonly Alert[], section: SectionDef): Facets {
  const counts = Object.fromEntries(SET_FIELDS.map((f) => [f.id, new Map<string, number>()])) as Record<SetFieldId, Map<string, number>>;

  for (const alert of alerts) {
    if (!inSection(alert, section)) continue;
    for (const field of SET_FIELDS) {
      const map = counts[field.id];
      const raw = (field as SetField).get(alert);
      if (typeof raw === 'string' || raw === null) {
        const value = raw ?? NONE;
        map.set(value, (map.get(value) ?? 0) + 1);
      } else if (raw.length === 0) {
        map.set(NONE, (map.get(NONE) ?? 0) + 1);
      } else {
        for (const value of raw) map.set(value, (map.get(value) ?? 0) + 1);
      }
    }
  }

  const facets = {} as Facets;
  for (const field of SET_FIELDS as readonly SetField[]) {
    const map = counts[field.id as SetFieldId];
    if (field.options) {
      const allowed = field.id === 'priority' ? section.priority : field.id === 'status' ? section.status : undefined;
      facets[field.id as SetFieldId] = field.options
        .filter((value) => !allowed || (allowed as readonly string[]).includes(value))
        .map((value) => ({ value, count: map.get(value) ?? 0 }));
    } else {
      facets[field.id as SetFieldId] = [...map]
        .map(([value, count]) => ({ value, count }))
        // "None" last, then alphabetical.
        .sort(
          (a, b) =>
            Number(a.value === NONE) - Number(b.value === NONE) ||
            a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }),
        );
    }
  }
  return facets;
}

/** Validates filters read from storage (or, later, from a server). Unknown fields are dropped. */
export function sanitizeFilters(stored: unknown): Filters {
  const out: Filters = { set: {}, date: {}, text: {} };
  if (typeof stored !== 'object' || stored === null) return out;
  const s = stored as { set?: unknown; date?: unknown; text?: unknown };
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];

  for (const field of SET_FIELDS) {
    const raw = record(record(s.set)[field.id]);
    const condition: SetCondition = {
      include: strings(raw.include),
      exclude: strings(raw.exclude),
      match: raw.match === 'all' ? 'all' : 'any',
    };
    if (isSetActive(condition)) out.set[field.id] = condition;
  }
  for (const field of DATE_FIELDS) {
    const raw = record(record(s.date)[field.id]);
    const preset = DATE_PRESETS.some((p) => p.id === raw.preset) ? (raw.preset as DatePreset) : 'any';
    if (preset !== 'any') {
      out.date[field.id] = {
        preset,
        from: typeof raw.from === 'string' ? raw.from : '',
        to: typeof raw.to === 'string' ? raw.to : '',
      };
    }
  }
  for (const field of TEXT_FIELDS) {
    const raw = record(s.text)[field.id];
    if (typeof raw === 'string' && raw !== '') out.text[field.id] = raw.slice(0, 200);
  }
  return out;
}
