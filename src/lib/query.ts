import { trimChar } from './id';
import { PRIORITIES, type Alert, type Priority } from '../../shared/types';
import { NONE, SET_FIELDS, STATUS_LABEL, teamsOf, TEXT_FIELDS, type SetField } from '../config/filterFields';

/**
 * Query language of the search box.
 *
 *   priority:P1 AND customer:Contoso
 *   status:open OR status:acked
 *   NOT tag:test            -tag:test
 *   service:"Azure SQL"     customer:Con*
 *   priority<=P2            count>5
 *   created<2h              created>2026-11-01
 *   customer:""             (no customer; also customer:none)
 *   disk full               (free words, as before: every word must appear)
 *
 * Grammar: OR binds loosest, then AND (also implied between neighbouring
 * terms), then NOT / "-". Parentheses group. Keywords are upper case
 * (AND, OR, NOT, also && and ||), so ordinary words like "not" stay text.
 * Field names and values are case-insensitive; `*` is a wildcard.
 * A word whose prefix is not a known field (for example "error:timeout")
 * is searched as plain text.
 *
 * compileQuery() parses once and returns a predicate; evaluation per alert
 * only runs pre-built closures. Pure: no React, no storage.
 */

// ---- Fields ---------------------------------------------------------------

type Op = ':' | '=' | '!=' | '<' | '<=' | '>' | '>=';

interface QueryField {
  name: string;
  kind: 'set' | 'text' | 'priority' | 'date' | 'number' | 'bool';
  get: (alert: Alert) => string | readonly string[] | number | boolean | null;
}

const setField = (id: string): SetField['get'] => (SET_FIELDS as readonly SetField[]).find((f) => f.id === id)!.get;
const textField = (id: string) => TEXT_FIELDS.find((f) => f.id === id)!.get;

const FIELDS: Record<string, QueryField> = {
  priority: { name: 'priority', kind: 'priority', get: (a) => a.priority },
  status: { name: 'status', kind: 'set', get: (a) => a.status },
  acknowledged: { name: 'acknowledged', kind: 'bool', get: (a) => a.acknowledged },
  customer: { name: 'customer', kind: 'set', get: setField('customer') },
  tag: { name: 'tag', kind: 'set', get: setField('tag') },
  service: { name: 'service', kind: 'set', get: setField('service') },
  team: { name: 'team', kind: 'set', get: teamsOf },
  assignee: { name: 'assignee', kind: 'set', get: setField('assignee') },
  source: { name: 'source', kind: 'set', get: setField('source') },
  integration: { name: 'integration', kind: 'set', get: setField('integration') },
  entity: { name: 'entity', kind: 'set', get: (a) => a.entity },
  summary: { name: 'summary', kind: 'text', get: textField('summary') },
  id: { name: 'id', kind: 'text', get: textField('identifier') },
  alias: { name: 'alias', kind: 'set', get: (a) => a.alias },
  created: { name: 'created', kind: 'date', get: (a) => a.createdAt },
  updated: { name: 'updated', kind: 'date', get: (a) => a.updatedAt },
  count: { name: 'count', kind: 'number', get: (a) => a.count },
};

const ALIASES: Record<string, string> = {
  p: 'priority',
  prio: 'priority',
  state: 'status',
  ack: 'acknowledged',
  acked: 'acknowledged',
  cust: 'customer',
  customers: 'customer',
  tags: 'tag',
  svc: 'service',
  teams: 'team',
  owner: 'assignee',
  integrationtype: 'integration',
  message: 'summary',
  tinyid: 'id',
  occurrences: 'count',
};

/** Field names shown in the syntax hint, in a useful order. */
export const QUERY_FIELDS = Object.keys(FIELDS);

function lookupField(raw: string): QueryField | null {
  const name = raw.toLowerCase();
  return FIELDS[name] ?? FIELDS[ALIASES[name] ?? ''] ?? null;
}

// ---- Tokens ---------------------------------------------------------------

type Token =
  | { type: 'word'; text: string; quoted: boolean; at: number }
  | { type: 'term'; field: QueryField; op: Op; value: string; quoted: boolean; at: number }
  | { type: 'and' | 'or' | 'not' | 'lparen' | 'rparen'; at: number };

export class QueryError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

const TERM = /^([A-Za-z][A-Za-z_]*)(!=|<=|>=|:|=|<|>)/;

function readValue(input: string, start: number): { value: string; quoted: boolean; end: number } {
  if (input[start] === '"') {
    const close = input.indexOf('"', start + 1);
    if (close === -1) throw new QueryError('Missing closing quote', start);
    return { value: input.slice(start + 1, close), quoted: true, end: close + 1 };
  }
  let end = start;
  while (end < input.length && !/[\s()"]/.test(input[end]!)) end += 1;
  return { value: input.slice(start, end), quoted: false, end };
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: ch === '(' ? 'lparen' : 'rparen', at: i });
      i += 1;
      continue;
    }
    // "-" directly before a word or group negates it.
    if (ch === '-' && i + 1 < input.length && /[^\s-]/.test(input[i + 1]!)) {
      tokens.push({ type: 'not', at: i });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const { value, end } = readValue(input, i);
      tokens.push({ type: 'word', text: value, quoted: true, at: i });
      i = end;
      continue;
    }
    const term = TERM.exec(input.slice(i));
    const field = term ? lookupField(term[1]!) : null;
    if (term && field) {
      const valueStart = i + term[0].length;
      const { value, quoted, end } = readValue(input, valueStart);
      tokens.push({ type: 'term', field, op: term[2] as Op, value, quoted, at: i });
      i = end;
      continue;
    }
    const { value, end } = readValue(input, i);
    // Keywords are upper case, so "not responding" stays a plain search.
    if (value === 'AND' || value === '&&') tokens.push({ type: 'and', at: i });
    else if (value === 'OR' || value === '||') tokens.push({ type: 'or', at: i });
    else if (value === 'NOT') tokens.push({ type: 'not', at: i });
    else tokens.push({ type: 'word', text: value, quoted: false, at: i });
    i = end;
  }
  return tokens;
}

// ---- Syntax tree ----------------------------------------------------------

export type Node =
  | { type: 'and' | 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'word'; text: string }
  | { type: 'term'; field: QueryField; op: Op; value: string; quoted: boolean; at: number };

function parseTokens(tokens: Token[], input: string): Node | null {
  let pos = 0;
  const peek = () => tokens[pos];
  const end = () => input.length;

  const parseOr = (): Node => {
    const children = [parseAnd()];
    while (peek()?.type === 'or') {
      pos += 1;
      if (!peek() || peek()!.type === 'rparen') throw new QueryError('Nothing after OR', tokens[pos - 1]!.at);
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0]! : { type: 'or', children };
  };

  const parseAnd = (): Node => {
    const children = [parseUnary()];
    for (;;) {
      const next = peek();
      if (!next || next.type === 'or' || next.type === 'rparen') break;
      if (next.type === 'and') {
        pos += 1;
        if (!peek() || peek()!.type === 'or' || peek()!.type === 'rparen') throw new QueryError('Nothing after AND', next.at);
      }
      children.push(parseUnary());
    }
    return children.length === 1 ? children[0]! : { type: 'and', children };
  };

  const parseUnary = (): Node => {
    const token = peek();
    if (!token) throw new QueryError('Incomplete query', end());
    if (token.type === 'not') {
      pos += 1;
      if (!peek()) throw new QueryError('Nothing after NOT', token.at);
      return { type: 'not', child: parseUnary() };
    }
    if (token.type === 'lparen') {
      pos += 1;
      if (peek()?.type === 'rparen') throw new QueryError('Empty parentheses', token.at);
      const inner = parseOr();
      if (peek()?.type !== 'rparen') throw new QueryError('Missing )', token.at);
      pos += 1;
      return inner;
    }
    if (token.type === 'rparen') throw new QueryError('Unexpected )', token.at);
    if (token.type === 'and' || token.type === 'or') throw new QueryError(`${token.type.toUpperCase()} needs something before it`, token.at);
    pos += 1;
    if (token.type === 'word') return { type: 'word', text: token.text };
    const term = token as Extract<Token, { type: 'term' }>;
    return { type: 'term', field: term.field, op: term.op, value: term.value, quoted: term.quoted, at: term.at };
  };

  if (tokens.length === 0) return null;
  const node = parseOr();
  if (pos < tokens.length) throw new QueryError('Unexpected )', tokens[pos]!.at);
  return node;
}

// ---- Compilation ----------------------------------------------------------

type Predicate = (alert: Alert) => boolean;

export interface CompileContext {
  now: number;
  /** Lower-cased text of everything plain words are matched against. */
  searchText: (alert: Alert) => string;
}

const DURATION = /^(\d+(?:\.\d+)?)(m|min|h|d|w)$/i;
const UNIT_MS: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i])) as Record<Priority, number>;

function wildcard(pattern: string): (value: string) => boolean {
  if (!pattern.includes('*')) return (value) => value === pattern;
  // Common shapes without a regular expression: text*, *text, *text*.
  const inner = trimChar(pattern, '*');
  if (!inner.includes('*')) {
    const starts = !pattern.startsWith('*');
    const ends = !pattern.endsWith('*');
    if (starts && !ends) return (value) => value.startsWith(inner);
    if (!starts && ends) return (value) => value.endsWith(inner);
    if (!starts && !ends) return (value) => value.includes(inner);
  }
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regex = new RegExp(`^${source}$`, 's');
  return (value) => regex.test(value);
}

/** True when the value means "empty": `field:""` or an unquoted `none`. */
function isEmptyValue(value: string, quoted: boolean): boolean {
  return (quoted && value === '') || (!quoted && value.toLowerCase() === 'none');
}

const STATUS_WORDS: Record<string, string> = { acknowledged: 'acked', ack: 'acked', resolved: 'closed' };
for (const [status, label] of Object.entries(STATUS_LABEL)) STATUS_WORDS[label.toLowerCase()] = status;

function compileTerm(node: Extract<Node, { type: 'term' }>, ctx: CompileContext): Predicate {
  const { field, op, quoted } = node;
  const raw = node.value;
  const fail = (message: string): never => {
    throw new QueryError(message, node.at);
  };
  if (raw === '' && !quoted) fail(`${field.name} needs a value`);
  const negate = op === '!=';
  const get = field.get;

  let predicate: Predicate;
  switch (field.kind) {
    case 'priority': {
      const wanted = raw.toUpperCase() as Priority;
      if (!(wanted in PRIORITY_RANK)) fail(`Unknown priority "${raw}"`);
      const rank = PRIORITY_RANK[wanted];
      // Lower number = more urgent: priority<=P2 means P1 or P2.
      const compare: Record<Op, (r: number) => boolean> = {
        ':': (r) => r === rank,
        '=': (r) => r === rank,
        '!=': (r) => r === rank,
        '<': (r) => r < rank,
        '<=': (r) => r <= rank,
        '>': (r) => r > rank,
        '>=': (r) => r >= rank,
      };
      const test = compare[op];
      predicate = (a) => test(PRIORITY_RANK[a.priority]);
      break;
    }
    case 'bool': {
      if (op !== ':' && op !== '=' && op !== '!=') fail(`${field.name} cannot be compared with ${op}`);
      const value = raw.toLowerCase();
      const yes = ['yes', 'true', '1', 'y'].includes(value);
      const no = ['no', 'false', '0', 'n'].includes(value);
      if (!yes && !no) fail(`${field.name} is yes or no`);
      predicate = (a) => get(a) === yes;
      break;
    }
    case 'number': {
      const value = Number(raw);
      if (!Number.isFinite(value)) fail(`${field.name} needs a number`);
      const compare: Record<Op, (n: number) => boolean> = {
        ':': (n) => n === value,
        '=': (n) => n === value,
        '!=': (n) => n === value,
        '<': (n) => n < value,
        '<=': (n) => n <= value,
        '>': (n) => n > value,
        '>=': (n) => n >= value,
      };
      const test = compare[op];
      predicate = (a) => test(get(a) as number);
      break;
    }
    case 'date': {
      const duration = DURATION.exec(raw);
      if (duration) {
        // Durations compare the age: created<2h = within the last 2 hours.
        const ms = Number(duration[1]) * UNIT_MS[duration[2]!.toLowerCase()]!;
        const cutoff = ctx.now - ms;
        const compare: Record<Op, (t: number) => boolean> = {
          ':': (t) => t >= cutoff,
          '=': (t) => t >= cutoff,
          '!=': (t) => t >= cutoff,
          '<': (t) => t > cutoff,
          '<=': (t) => t >= cutoff,
          '>': (t) => t < cutoff,
          '>=': (t) => t <= cutoff,
        };
        const test = compare[op];
        predicate = (a) => {
          const t = get(a) as number | null;
          return t !== null && t > 0 && test(t);
        };
        break;
      }
      // Dates compare the time itself: created>2026-11-01 = after that day.
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00`) : Date.parse(raw);
      if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || !Number.isFinite(date)) fail(`Use a duration (2h, 3d) or a date (2026-11-01) for ${field.name}`);
      const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
      const next = dayOnly ? date + 86_400_000 : date;
      const compare: Record<Op, (t: number) => boolean> = {
        ':': (t) => t >= date && t < next,
        '=': (t) => t >= date && t < next,
        '!=': (t) => t >= date && t < next,
        '<': (t) => t < date,
        '<=': (t) => t < next,
        '>': (t) => t >= next,
        '>=': (t) => t >= date,
      };
      const test = compare[op];
      predicate = (a) => {
        const t = get(a) as number | null;
        return t !== null && t > 0 && test(t);
      };
      break;
    }
    case 'text': {
      if (op !== ':' && op !== '=' && op !== '!=') fail(`${field.name} cannot be compared with ${op}`);
      let needle = raw.toLowerCase();
      if (field.name === 'id') needle = needle.replace(/^#/, '');
      // Text fields match "contains" unless the pattern has wildcards.
      const match = needle.includes('*') ? wildcard(needle) : (v: string) => v.includes(needle);
      predicate = (a) => {
        const value = String(get(a) ?? '').toLowerCase();
        return field.name === 'id' ? value.split('\n').some((part) => part !== '' && match(part)) : match(value);
      };
      break;
    }
    case 'set': {
      if (op !== ':' && op !== '=' && op !== '!=') fail(`${field.name} cannot be compared with ${op}`);
      if (isEmptyValue(raw, quoted)) {
        predicate = (a) => {
          const value = get(a);
          return value === null || value === NONE || (Array.isArray(value) && value.length === 0);
        };
        break;
      }
      let needle = raw.toLowerCase();
      if (field.name === 'status') needle = STATUS_WORDS[needle] ?? needle;
      const match = wildcard(needle);
      predicate = (a) => {
        const value = get(a);
        if (value === null) return false;
        if (typeof value === 'string') return match(value.toLowerCase());
        for (const item of value as readonly string[]) if (match(item.toLowerCase())) return true;
        return false;
      };
      break;
    }
  }
  return negate ? (a) => !predicate(a) : predicate;
}

function compileNode(node: Node, ctx: CompileContext): Predicate {
  switch (node.type) {
    case 'and': {
      const parts = node.children.map((child) => compileNode(child, ctx));
      return (a) => {
        for (const part of parts) if (!part(a)) return false;
        return true;
      };
    }
    case 'or': {
      const parts = node.children.map((child) => compileNode(child, ctx));
      return (a) => {
        for (const part of parts) if (part(a)) return true;
        return false;
      };
    }
    case 'not': {
      const inner = compileNode(node.child, ctx);
      return (a) => !inner(a);
    }
    case 'word': {
      const needle = node.text.toLowerCase();
      if (needle === '') return () => true;
      if (needle.includes('*')) {
        const parts = needle.split('*').filter(Boolean);
        return (a) => {
          const text = ctx.searchText(a);
          return parts.every((p) => text.includes(p));
        };
      }
      return (a) => ctx.searchText(a).includes(needle);
    }
    case 'term':
      return compileTerm(node, ctx);
  }
}

export type CompiledQuery =
  | { ok: true; predicate: Predicate | null; structured: boolean }
  | { ok: false; error: string; at: number; predicate: Predicate | null };

/** Uses query syntax: a field term, a keyword, a group, a negation or a quoted phrase. */
function hasSyntax(tokens: Token[]): boolean {
  return tokens.some((t) => t.type !== 'word' || t.quoted);
}

/** Plain words, as the search box always worked: every word must appear somewhere. */
function plainWords(input: string, ctx: CompileContext): Predicate | null {
  const terms = input.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  return (a) => {
    const text = ctx.searchText(a);
    for (const term of terms) if (!text.includes(term)) return false;
    return true;
  };
}

/**
 * Parses and compiles the search text. On a syntax error the result carries
 * the message and falls back to plain-word matching, so the list stays usable.
 */
export function compileQuery(input: string, ctx: CompileContext): CompiledQuery {
  const text = input.trim();
  if (text === '') return { ok: true, predicate: null, structured: false };
  try {
    const tokens = tokenize(text);
    if (!hasSyntax(tokens)) return { ok: true, predicate: plainWords(text, ctx), structured: false };
    const tree = parseTokens(tokens, text);
    return { ok: true, predicate: tree ? compileNode(tree, ctx) : null, structured: true };
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return { ok: false, error: error.message, at: error.at, predicate: plainWords(text, ctx) };
  }
}

/** Only checks the syntax, for showing an error next to the search box. */
export function checkQuery(input: string): { ok: true; structured: boolean } | { ok: false; error: string } {
  const result = compileQuery(input, { now: Date.now(), searchText: () => '' });
  return result.ok ? { ok: true, structured: result.structured } : { ok: false, error: result.error };
}

export const QUERY_HELP = [
  'priority:P1 AND customer:Contoso',
  'status:open OR status:acked',
  'NOT tag:test   -tag:test',
  'service:"Azure SQL"   customer:Con*',
  'priority<=P2   count>5',
  'created<2h   created>2026-11-01',
  'assignee:none   customer:""',
  `Fields: ${QUERY_FIELDS.join(', ')}`,
].join('\n');
