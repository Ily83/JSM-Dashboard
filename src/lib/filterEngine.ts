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
  if (condition.preset === 'any') delete date[id];
  else date[id] = condition;
  return { ...filters, date };
}

export function withText(filters: Filters, id: TextFieldId, value: string): Filters {
  const text = { ...filters.text };
  if (value === '') delete text[id];
  else text[id] = value;
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
    const from = condition.from ? Date.parse(condition.from) : Number.NaN;
    const to = condition.to ? Date.parse(condition.to) : Number.NaN;
    if (Number.isNaN(from) && Number.isNaN(to)) return null;
    return [Number.isNaN(from) ? -Infinity : from, Number.isNaN(to) ? Infinity : to];
  }
  const preset = DATE_PRESETS.find((p) => p.id === condition.preset);
  return preset?.ms ? [now - preset.ms, Infinity] : null;
}

type Predicate = (alert: Alert) => boolean;

/** The values of a fixed-option field that the section allows, or undefined for no restriction. */
function sectionAllowed(id: SetFieldId, section: SectionDef): readonly string[] | undefined {
  if (id === 'priority') return section.priority;
  if (id === 'status') return section.status;
  return undefined;
}

function hasAny(values: readonly string[], set: ReadonlySet<string>): boolean {
  for (const value of values) if (set.has(value)) return true;
  return false;
}

function hasAll(values: readonly string[], wanted: ReadonlySet<string>): boolean {
  for (const value of wanted) if (!values.includes(value)) return false;
  return true;
}

/** Included and excluded values of one set condition; null when that side is empty. */
interface SetMatch {
  include: ReadonlySet<string> | null;
  exclude: ReadonlySet<string> | null;
  /** All included values must be present (multi-value fields only). */
  all: boolean;
}

/** A field with one value per alert (or none, as NONE). */
function matchesSingle(value: string, { include, exclude }: SetMatch): boolean {
  if (exclude?.has(value)) return false;
  return include ? include.has(value) : true;
}

/** A multi-value field without values: it matches NONE. */
function matchesEmpty({ include, exclude, all }: SetMatch): boolean {
  if (exclude?.has(NONE)) return false;
  return include ? include.has(NONE) && (!all || include.size === 1) : true;
}

function matchesMany(values: readonly string[], { include, exclude, all }: SetMatch): boolean {
  if (exclude && hasAny(values, exclude)) return false;
  if (!include) return true;
  return all ? hasAll(values, include) : hasAny(values, include);
}

function setPredicate(field: SetField, condition: SetCondition, allowed: readonly string[] | undefined): Predicate | null {
  // A value the current section does not allow is ignored instead of emptying the table.
  const includeValues = allowed ? condition.include.filter((v) => allowed.includes(v)) : condition.include;
  const include = includeValues.length > 0 ? new Set(includeValues) : null;
  const exclude = condition.exclude.length > 0 ? new Set(condition.exclude) : null;
  if (!include && !exclude) return null;
  const match: SetMatch = { include, exclude, all: field.multi && condition.match === 'all' };
  const get = field.get;

  return (alert) => {
    const raw = get(alert);
    if (typeof raw === 'string' || raw === null) return matchesSingle(raw ?? NONE, match);
    if (raw.length === 0) return matchesEmpty(match);
    return matchesMany(raw, match);
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

function setPredicates(filters: Filters, section: SectionDef, out: Predicate[]): void {
  for (const field of SET_FIELDS) {
    const condition = filters.set[field.id];
    if (!isSetActive(condition)) continue;
    const predicate = setPredicate(field, condition, sectionAllowed(field.id, section));
    if (predicate) out.push(predicate);
  }
}

function datePredicates(filters: Filters, now: number, out: Predicate[]): void {
  for (const field of DATE_FIELDS) {
    const condition = filters.date[field.id];
    const range = isDateActive(condition) ? dateRange(condition, now) : null;
    if (!range) continue;
    const [from, to] = range;
    const get = field.get;
    out.push((alert) => {
      const time = get(alert);
      return time !== null && time >= from && time <= to;
    });
  }
}

function textPredicates(filters: Filters, out: Predicate[]): void {
  for (const field of TEXT_FIELDS) {
    const value = filters.text[field.id];
    if (!isTextActive(value)) continue;
    const text = value.trim().toLowerCase();
    const needle = field.id === 'identifier' ? text.replace(/^#/, '') : text;
    const get = field.get;
    out.push((alert) => get(alert).toLowerCase().includes(needle));
  }
}

function matchesAll(alert: Alert, predicates: readonly Predicate[]): boolean {
  for (const predicate of predicates) if (!predicate(alert)) return false;
  return true;
}

/** Applies section, quick filter, filters and search in a single pass. */
export function filterAlerts(alerts: readonly Alert[], query: ViewQuery): Alert[] {
  const { section, filters, profile } = query;
  const predicates: Predicate[] = [];

  setPredicates(filters, section, predicates);
  datePredicates(filters, query.now, predicates);
  textPredicates(filters, predicates);
  const quick = quickFilterById(query.quick);
  if (quick) predicates.push((alert) => quick.test(alert, profile));
  // Plain words or the query language (src/lib/query.ts), compiled once.
  const search = compileQuery(query.search, { now: query.now, searchText });
  if (search.predicate) predicates.push(search.predicate);

  const out: Alert[] = [];
  for (const alert of alerts) {
    if (inSection(alert, section) && matchesAll(alert, predicates)) out.push(alert);
  }
  return out;
}

export interface FacetOption {
  value: string;
  count: number;
}
export type Facets = Record<SetFieldId, FacetOption[]>;

function increment(map: Map<string, number>, value: string): void {
  map.set(value, (map.get(value) ?? 0) + 1);
}

/** Adds one alert's values of one field to its counts; no value counts as NONE. */
function countValues(map: Map<string, number>, raw: string | readonly string[] | null): void {
  if (typeof raw === 'string' || raw === null) increment(map, raw ?? NONE);
  else if (raw.length === 0) increment(map, NONE);
  else for (const value of raw) increment(map, value);
}

function facetOptions(field: SetField, map: ReadonlyMap<string, number>, section: SectionDef): FacetOption[] {
  if (field.options) {
    const allowed = sectionAllowed(field.id as SetFieldId, section);
    return field.options
      .filter((value) => !allowed || allowed.includes(value))
      .map((value) => ({ value, count: map.get(value) ?? 0 }));
  }
  // "None" last, then alphabetical.
  return [...map]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (a, b) =>
        Number(a.value === NONE) - Number(b.value === NONE) ||
        a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }),
    );
}

/** Available values per filter with the number of alerts in the section. */
export function buildFacets(alerts: readonly Alert[], section: SectionDef): Facets {
  const counts = Object.fromEntries(SET_FIELDS.map((f) => [f.id, new Map<string, number>()])) as Record<SetFieldId, Map<string, number>>;

  for (const alert of alerts) {
    if (!inSection(alert, section)) continue;
    for (const field of SET_FIELDS) countValues(counts[field.id], (field as SetField).get(alert));
  }

  const facets = {} as Facets;
  for (const field of SET_FIELDS as readonly SetField[]) {
    facets[field.id as SetFieldId] = facetOptions(field, counts[field.id as SetFieldId], section);
  }
  return facets;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];
}

function sanitizeSetFilters(stored: unknown, out: Filters): void {
  for (const field of SET_FIELDS) {
    const raw = asRecord(asRecord(stored)[field.id]);
    const condition: SetCondition = {
      include: uniqueStrings(raw.include),
      exclude: uniqueStrings(raw.exclude),
      match: raw.match === 'all' ? 'all' : 'any',
    };
    if (isSetActive(condition)) out.set[field.id] = condition;
  }
}

function sanitizeDateFilters(stored: unknown, out: Filters): void {
  for (const field of DATE_FIELDS) {
    const raw = asRecord(asRecord(stored)[field.id]);
    const preset = DATE_PRESETS.some((p) => p.id === raw.preset) ? (raw.preset as DatePreset) : 'any';
    if (preset !== 'any') {
      out.date[field.id] = {
        preset,
        from: typeof raw.from === 'string' ? raw.from : '',
        to: typeof raw.to === 'string' ? raw.to : '',
      };
    }
  }
}

function sanitizeTextFilters(stored: unknown, out: Filters): void {
  for (const field of TEXT_FIELDS) {
    const raw = asRecord(stored)[field.id];
    if (typeof raw === 'string' && raw !== '') out.text[field.id] = raw.slice(0, 200);
  }
}

/** Validates filters read from storage (or, later, from a server). Unknown fields are dropped. */
export function sanitizeFilters(stored: unknown): Filters {
  const out: Filters = { set: {}, date: {}, text: {} };
  if (typeof stored !== 'object' || stored === null) return out;
  const s = stored as { set?: unknown; date?: unknown; text?: unknown };
  sanitizeSetFilters(s.set, out);
  sanitizeDateFilters(s.date, out);
  sanitizeTextFilters(s.text, out);
  return out;
}
