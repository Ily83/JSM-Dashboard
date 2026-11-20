import type { SortingState } from '@tanstack/react-table';
import { DEFAULT_SORTING, EMPTY_VIEW_STATE, sanitizeViewState, type ViewState } from '../state/views';
import type { DateCondition, Filters, SetCondition } from './filterEngine';
import { deepEqual } from './store';

/**
 * The current view (quick filter, filters, search, sorting) as URL
 * parameters, so a filtered list can be shared as a link:
 *
 *   #/active?quick=critical&q=customer%3AContoso&f=<base64url>&sort=priority,-createdAt
 *
 *   quick  quick filter id
 *   q      search text or query
 *   f      filters, compact JSON in base64url
 *   sort   column ids, "-" for descending; left out when it is the default
 *   v      "1" marks an explicit view, so a link to an unfiltered list
 *          clears the filters of whoever opens it
 *
 * Decoding never trusts the link: everything goes through the same
 * sanitisers as stored views, so unknown fields or values are dropped.
 */

/** Compact form of Filters: arrays instead of objects, empty parts left out. */
interface CompactFilters {
  s?: Record<string, [string[], string[]?, 'all'?]>;
  d?: Record<string, [string, string?, string?]>;
  t?: Record<string, string>;
}

function compactFilters(filters: Filters): CompactFilters | null {
  const out: CompactFilters = {};
  for (const [id, c] of Object.entries(filters.set) as Array<[string, SetCondition]>) {
    const entry: [string[], string[]?, 'all'?] = [c.include];
    if (c.exclude.length > 0 || c.match === 'all') entry.push(c.exclude);
    if (c.match === 'all') entry.push('all');
    out.s ??= {};
    out.s[id] = entry;
  }
  for (const [id, c] of Object.entries(filters.date) as Array<[string, DateCondition]>) {
    out.d ??= {};
    out.d[id] = c.preset === 'custom' ? [c.preset, c.from, c.to] : [c.preset];
  }
  for (const [id, value] of Object.entries(filters.text) as Array<[string, string]>) {
    out.t ??= {};
    out.t[id] = value;
  }
  return out.s || out.d || out.t ? out : null;
}

function expandFilters(compact: unknown): unknown {
  if (typeof compact !== 'object' || compact === null) return null;
  const c = compact as Record<string, unknown>;
  const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const set: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(rec(c.s))) {
    if (!Array.isArray(entry)) continue;
    set[id] = { include: entry[0], exclude: entry[1] ?? [], match: entry[2] === 'all' ? 'all' : 'any' };
  }
  const date: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(rec(c.d))) {
    if (!Array.isArray(entry)) continue;
    date[id] = { preset: entry[0], from: entry[1] ?? '', to: entry[2] ?? '' };
  }
  return { set, date, text: rec(c.t) };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  let encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_');
  while (encoded.endsWith('=')) encoded = encoded.slice(0, -1);
  return encoded;
}

function fromBase64Url(value: string): string | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    // atob returns one character per byte (0-255), so the code point is the byte.
    const bytes = Uint8Array.from(binary, (ch) => ch.codePointAt(0)!);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function encodeSorting(sorting: SortingState): string | null {
  if (deepEqual(sorting, DEFAULT_SORTING)) return null;
  return sorting.map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',');
}

function decodeSorting(value: string): unknown {
  return value
    .split(',')
    .filter(Boolean)
    .map((part) => (part.startsWith('-') ? { id: part.slice(1), desc: true } : { id: part, desc: false }));
}

const VIEW_KEYS = ['v', 'quick', 'q', 'f', 'sort'] as const;

/**
 * Encodes a view as a query string; empty for the default view unless
 * `explicit` is set (links copied for sharing).
 */
export function encodeView(state: ViewState, options: { explicit?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (options.explicit) params.set('v', '1');
  if (state.quick) params.set('quick', state.quick);
  if (state.search.trim() !== '') params.set('q', state.search);
  const filters = compactFilters(state.filters);
  if (filters) params.set('f', toBase64Url(JSON.stringify(filters)));
  const sort = encodeSorting(state.sorting);
  if (sort) params.set('sort', sort);
  return params.toString();
}

/** True when the query string carries any view parameter. */
export function hasViewParams(query: string): boolean {
  const params = new URLSearchParams(query);
  return VIEW_KEYS.some((key) => params.has(key));
}

/**
 * Decodes view parameters. Null when there are none, so a plain address
 * keeps the user's own state. Invalid parts are ignored, not fatal.
 */
export function decodeView(query: string): ViewState | null {
  if (!hasViewParams(query)) return null;
  const params = new URLSearchParams(query);
  const raw: Record<string, unknown> = { ...EMPTY_VIEW_STATE() };
  const quick = params.get('quick');
  if (quick) raw.quick = quick;
  const search = params.get('q');
  if (search) raw.search = search;
  const f = params.get('f');
  if (f) {
    const json = fromBase64Url(f);
    if (json !== null) {
      try {
        raw.filters = expandFilters(JSON.parse(json));
      } catch {
        // A damaged filter part is dropped; the rest of the link still applies.
      }
    }
  }
  const sort = params.get('sort');
  if (sort) raw.sorting = decodeSorting(sort);
  const state = sanitizeViewState(raw);
  // An unparsable sort parameter would leave no sorting at all: use the default.
  if (state.sorting.length === 0) state.sorting = DEFAULT_SORTING;
  return state;
}
