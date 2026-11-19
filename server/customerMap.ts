import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Optional mapping from an alert's entity to customers (CUSTOMER_MAP_FILE),
 * for alerts whose tags and extra properties do not name the customer. It
 * adds to those rules; it never removes a customer found by them.
 *
 * Two formats, chosen by the file extension:
 *
 *   .csv   entity,customers                 (header line optional)
 *          vm-contoso-*,Contoso
 *          sqlmi-fin-prod,Woodgrove Bank
 *          er-ams-01,"Contoso; Fabrikam"     (several customers: ; or |)
 *          # comment lines and blank lines are ignored
 *
 *   .json  { "vm-contoso-*": "Contoso", "er-ams-01": ["Contoso", "Fabrikam"] }
 *          or [{ "entity": "vm-contoso-*", "customers": ["Contoso"] }]
 *
 * Patterns match the whole entity, ignoring case. `*` stands for any
 * characters and `?` for one. Every matching line adds its customers.
 *
 * Errors name the line or entry and the problem, never the file's content.
 */

export const CUSTOMER_MAP_MAX_BYTES = 1_000_000;
export const CUSTOMER_MAP_MAX_RULES = 10_000;
const MAX_PATTERN = 200;
const MAX_NAME = 100;
const MAX_CUSTOMERS_PER_RULE = 20;

export interface CustomerMapRule {
  pattern: string;
  customers: string[];
}

export interface CustomerMap {
  /** Number of rules, shown in Settings. */
  readonly size: number;
  /** Customers for an entity, in rule order, without duplicates. */
  lookup(entity: string | null | undefined): readonly string[];
}

export class CustomerMapError extends Error {
  constructor(message: string) {
    super(`CUSTOMER_MAP_FILE: ${message}`);
    this.name = 'CustomerMapError';
  }
}

function splitCustomers(value: string): string[] {
  return value
    .split(/[;|]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function checkRule(rule: CustomerMapRule, where: string): CustomerMapRule {
  const pattern = rule.pattern.trim();
  if (!pattern) throw new CustomerMapError(`${where}: the entity pattern is empty.`);
  if (pattern.length > MAX_PATTERN) throw new CustomerMapError(`${where}: the entity pattern is longer than ${MAX_PATTERN} characters.`);
  if (/^\*+$/.test(pattern)) throw new CustomerMapError(`${where}: a pattern of only "*" would match every alert.`);
  const customers = [...new Set(rule.customers.map((c) => c.trim()).filter(Boolean))];
  if (customers.length === 0) throw new CustomerMapError(`${where}: no customer given.`);
  if (customers.length > MAX_CUSTOMERS_PER_RULE) throw new CustomerMapError(`${where}: more than ${MAX_CUSTOMERS_PER_RULE} customers.`);
  if (customers.some((c) => c.length > MAX_NAME)) throw new CustomerMapError(`${where}: a customer name is longer than ${MAX_NAME} characters.`);
  return { pattern, customers };
}

/** Splits one CSV line, honouring double quotes ("a, b" and "" for a quote). */
function csvCells(line: string, where: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new CustomerMapError(`${where}: a quote is not closed.`);
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export function parseCustomerMapCsv(text: string): CustomerMapRule[] {
  const rules: CustomerMapRule[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const cells = csvCells(line, where);
    if (rules.length === 0 && /^entity$/i.test(cells[0] ?? '')) return; // header
    if (cells.length < 2) throw new CustomerMapError(`${where}: expected "entity,customers".`);
    // Customers may also be spread over further columns.
    rules.push(checkRule({ pattern: cells[0]!, customers: cells.slice(1).flatMap(splitCustomers) }, where));
  });
  return rules;
}

export function parseCustomerMapJson(text: string): CustomerMapRule[] {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new CustomerMapError('the file is not valid JSON.');
  }
  const asList = (value: unknown, where: string): string[] => {
    if (typeof value === 'string') return splitCustomers(value);
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
    throw new CustomerMapError(`${where}: customers must be a name or a list of names.`);
  };
  if (Array.isArray(data)) {
    return data.map((item, i) => {
      const where = `entry ${i + 1}`;
      if (!item || typeof item !== 'object') throw new CustomerMapError(`${where}: expected an object with "entity" and "customers".`);
      const record = item as Record<string, unknown>;
      if (typeof record.entity !== 'string') throw new CustomerMapError(`${where}: "entity" is missing.`);
      return checkRule({ pattern: record.entity, customers: asList(record.customers ?? record.customer, where) }, where);
    });
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).map(([pattern, value], i) => checkRule({ pattern, customers: asList(value, `entry ${i + 1}`) }, `entry ${i + 1}`));
  }
  throw new CustomerMapError('expected an object or a list.');
}

function toRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

export function buildCustomerMap(rules: readonly CustomerMapRule[]): CustomerMap {
  if (rules.length > CUSTOMER_MAP_MAX_RULES) throw new CustomerMapError(`more than ${CUSTOMER_MAP_MAX_RULES} lines.`);
  const exact = new Map<string, Array<{ order: number; customers: string[] }>>();
  const wildcard: Array<{ order: number; test: RegExp; customers: string[] }> = [];
  rules.forEach((rule, order) => {
    if (/[*?]/.test(rule.pattern)) {
      wildcard.push({ order, test: toRegExp(rule.pattern), customers: rule.customers });
    } else {
      const key = rule.pattern.toLowerCase();
      exact.set(key, [...(exact.get(key) ?? []), { order, customers: rule.customers }]);
    }
  });
  const cache = new Map<string, readonly string[]>();
  const NONE: readonly string[] = [];
  return {
    size: rules.length,
    lookup(entity) {
      const key = entity?.trim().toLowerCase();
      if (!key) return NONE;
      const hit = cache.get(key);
      if (hit) return hit;
      const matches = [...(exact.get(key) ?? []), ...wildcard.filter((w) => w.test.test(key))].sort((a, b) => a.order - b.order);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const match of matches) {
        for (const customer of match.customers) {
          if (seen.has(customer.toLowerCase())) continue;
          seen.add(customer.toLowerCase());
          out.push(customer);
        }
      }
      const result = out.length > 0 ? out : NONE;
      if (cache.size < 50_000) cache.set(key, result);
      return result;
    },
  };
}

/** Reads and validates the file at start-up. Throws CustomerMapError with a safe message. */
export function loadCustomerMap(file: string): CustomerMap {
  const resolved = path.resolve(file);
  const extension = path.extname(resolved).toLowerCase();
  if (extension !== '.csv' && extension !== '.json') throw new CustomerMapError('use a .csv or .json file.');
  let size: number;
  try {
    size = statSync(resolved).size;
  } catch {
    throw new CustomerMapError('the file cannot be read. Check the path.');
  }
  if (size > CUSTOMER_MAP_MAX_BYTES) throw new CustomerMapError(`the file is larger than ${CUSTOMER_MAP_MAX_BYTES / 1_000_000} MB.`);
  const text = readFileSync(resolved, 'utf8');
  return buildCustomerMap(extension === '.csv' ? parseCustomerMapCsv(text) : parseCustomerMapJson(text));
}
