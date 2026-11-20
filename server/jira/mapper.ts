import {
  PRIORITIES,
  type Alert,
  type AlertDetail,
  type AlertStatus,
  type ExtractionRules,
  type Priority,
  type Responder,
  type ResponderType,
} from '../../shared/types';
import type { RawAlert } from './schemas';

/**
 * Raw Jira alert -> application model.
 *
 * Jira Operations alerts have no "customer" field and no "service" field.
 * Both are derived here, using rules from configuration:
 *   - a tag with a configured prefix, e.g. "customer:Contoso"
 *   - an extra property with a configured key, e.g. customer = "Contoso, Fabrikam"
 *   - for the service only: fallback to the alert's `entity`
 */

export interface MapContext {
  rules: ExtractionRules;
  /** Team id -> team name, from the List teams endpoint. */
  teamNames: ReadonlyMap<string, string>;
  /** Id -> name for users, schedules and escalations, when known. */
  otherNames?: ReadonlyMap<string, string>;
  /** Customers for an entity from CUSTOMER_MAP_FILE; adds to the tag and property rules. */
  customersForEntity?: (entity: string | null) => readonly string[];
  /** Builds the "Open in Jira" link, or null when there is no Jira site. */
  alertUrl: (id: string) => string | null;
}

const RESPONDER_TYPES: ReadonlySet<string> = new Set(['team', 'user', 'escalation', 'schedule']);

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function matchPrefix(tag: string, prefixes: string[]): string | null {
  const lower = tag.toLowerCase();
  for (const prefix of prefixes) {
    if (prefix && lower.startsWith(prefix.toLowerCase())) {
      return clean(tag.slice(prefix.length));
    }
  }
  return null;
}

export function normaliseStatus(raw: RawAlert): AlertStatus {
  const status = (raw.status ?? '').toLowerCase();
  if (status === 'closed' || status === 'resolved') return 'closed';
  if (status === 'snoozed' || raw.snoozed === true) return 'snoozed';
  if (status === 'acked' || status === 'acknowledged' || raw.acknowledged === true) return 'acked';
  return 'open';
}

function normalisePriority(raw: string | null | undefined): Priority {
  const value = (raw ?? '').toUpperCase() as Priority;
  // P3 is the API's documented default priority.
  return PRIORITIES.includes(value) ? value : 'P3';
}

function stringifyProperties(input: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

function addUnique(target: string[], seen: Set<string>, value: string | null): void {
  if (!value) return;
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(value);
}

type AddCustomer = (value: string | null) => void;

/** Customer tags go to `addCustomer`; returns the first service tag and the remaining tags. */
function readTags(rawTags: string[], rules: ExtractionRules, addCustomer: AddCustomer): { service: string | null; otherTags: string[] } {
  const otherTags: string[] = [];
  let service: string | null = null;
  const companyPrefixes = new Map(rules.customerCompanyTagPrefixes.map((name) => [name.toLowerCase(), name]));
  for (const tag of rawTags) {
    const customer = matchPrefix(tag, rules.customerTagPrefixes);
    if (customer) {
      addCustomer(customer);
      continue;
    }
    const company = tag.trim().split('-', 1)[0]?.toLowerCase();
    if (company) addCustomer(companyPrefixes.get(company) ?? null);
    const tagService = matchPrefix(tag, rules.serviceTagPrefixes);
    if (tagService) {
      service ??= tagService;
      continue;
    }
    otherTags.push(tag);
  }
  return { service, otherTags };
}

/** Customer properties go to `addCustomer`; returns the first service property. */
function readProperties(extraProperties: Record<string, string>, rules: ExtractionRules, addCustomer: AddCustomer): string | null {
  const customerKeys = new Set(rules.customerPropertyKeys.map((k) => k.toLowerCase()));
  const serviceKeys = new Set(rules.servicePropertyKeys.map((k) => k.toLowerCase()));
  let service: string | null = null;
  for (const [key, value] of Object.entries(extraProperties)) {
    const lower = key.toLowerCase();
    if (customerKeys.has(lower)) {
      for (const part of value.split(/[,;|]/)) addCustomer(clean(part));
    } else if (serviceKeys.has(lower)) {
      service ??= clean(value);
    }
  }
  return service;
}

function mapResponder(r: NonNullable<RawAlert['responders']>[number], ctx: MapContext): Responder {
  const type = (r.type ?? '').toLowerCase();
  const responder: Responder = {
    id: r.id,
    type: (RESPONDER_TYPES.has(type) ? type : 'unknown') as ResponderType,
  };
  const name = type === 'team' ? ctx.teamNames.get(r.id) : ctx.otherNames?.get(r.id);
  if (name) responder.name = name;
  return responder;
}

export function mapAlert(raw: RawAlert, ctx: MapContext, fromDetailEndpoint = false): AlertDetail {
  const { rules } = ctx;
  const rawTags = (raw.tags ?? []).filter((t) => typeof t === 'string' && t.trim() !== '');
  const extraProperties = stringifyProperties(raw.extraProperties);

  // Customers from tags, then properties, then the customer map; unique regardless of case.
  const customers: string[] = [];
  const seenCustomers = new Set<string>();
  const addCustomer: AddCustomer = (value) => addUnique(customers, seenCustomers, value);

  const fromTags = readTags(rawTags, rules, addCustomer);
  const fromProperties = readProperties(extraProperties, rules, addCustomer);
  // A service tag wins over a service property.
  let service = fromTags.service ?? fromProperties;

  const entity = clean(raw.entity);
  for (const customer of ctx.customersForEntity?.(entity) ?? []) addCustomer(customer);
  if (!service && rules.serviceFallbackToEntity) service = entity;
  customers.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const responders: Responder[] = (raw.responders ?? []).map((r) => mapResponder(r, ctx));
  const otherTags = fromTags.otherTags;

  const createdAt = toTime(raw.createdAt) ?? toTime(raw.updatedAt) ?? 0;
  const updatedAt = toTime(raw.updatedAt) ?? createdAt;
  const integrationName = clean(raw.integrationName);
  const integrationType = clean(raw.integrationType);
  const rawSource = clean(raw.source);

  return {
    id: raw.id,
    tinyId: raw.tinyId === null || raw.tinyId === undefined ? null : String(raw.tinyId),
    alias: clean(raw.alias),
    summary: clean(raw.message) ?? '(no summary)',
    priority: normalisePriority(raw.priority),
    status: normaliseStatus(raw),
    rawStatus: clean(raw.status),
    acknowledged: raw.acknowledged ?? (raw.status ?? '').toLowerCase() === 'acked',
    customers,
    tags: otherTags,
    service,
    entity,
    assignee: clean(raw.owner),
    responders,
    source: integrationName ?? rawSource ?? integrationType ?? 'Unknown',
    rawSource,
    integrationName,
    integrationType,
    createdAt,
    updatedAt,
    lastOccurredAt: toTime(raw.lastOccuredAt),
    ackTime: toTime(raw.ackTime),
    closeTime: toTime(raw.closeTime),
    snoozedUntil: toTime(raw.snoozedUntil),
    count: typeof raw.count === 'number' && raw.count > 0 ? raw.count : 1,
    url: ctx.alertUrl(raw.id),
    description: clean(raw.description),
    rawTags,
    extraProperties,
    actions: raw.actions ?? [],
    seen: raw.seen ?? null,
    detailLoaded:
      fromDetailEndpoint || (raw.extraProperties !== undefined && raw.extraProperties !== null),
  };
}

/** Strips the detail-only fields to keep the list payload small. */
export function toListItem(detail: AlertDetail): Alert {
  const {
    description: _description,
    rawTags: _rawTags,
    extraProperties: _extraProperties,
    actions: _actions,
    seen: _seen,
    detailLoaded: _detailLoaded,
    detailError: _detailError,
    ...alert
  } = detail;
  return alert;
}
