import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { checkQuery, compileQuery, tokenize } from '../src/lib/query';
import { makeAlert } from './fixtures';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const H = 3_600_000;

const alerts: Alert[] = [
  makeAlert({ id: 'a1', priority: 'P1', summary: 'API server unreachable', customers: ['Contoso'], createdAt: NOW - 30 * 60_000, count: 7 }),
  makeAlert({ id: 'a2', priority: 'P2', status: 'acked', acknowledged: true, summary: 'Replication lag', customers: ['Woodgrove Bank'], createdAt: NOW - 5 * H }),
  makeAlert({ id: 'a3', priority: 'P3', status: 'closed', summary: 'Disk full', createdAt: NOW - 3 * 24 * H }),
];

function ids(query: string): string[] {
  const compiled = compileQuery(query, { now: NOW, searchText: (a) => a.summary.toLowerCase() });
  if (!compiled.ok) throw new Error(`unexpected error for "${query}": ${compiled.error}`);
  return compiled.predicate ? alerts.filter(compiled.predicate).map((a) => a.id) : alerts.map((a) => a.id);
}

describe('query terms', () => {
  it('negates every kind of field with !=', () => {
    expect(ids('priority!=P1')).toEqual(['a2', 'a3']);
    expect(ids('ack!=yes')).toEqual(['a1', 'a3']);
    expect(ids('count!=1')).toEqual(['a1']);
    expect(ids('created!=6h')).toEqual(['a3']);
    expect(ids('summary!=disk')).toEqual(['a1', 'a2']);
    expect(ids('customer!=contoso')).toEqual(['a2', 'a3']);
  });

  it('compares a date with a time of day as an instant', () => {
    expect(ids('created>=2026-11-19T11:00:00Z')).toEqual(['a1']);
    expect(ids('created<2026-11-19T11:00:00Z')).toEqual(['a2', 'a3']);
  });

  it('checks the values of yes/no fields and the operators of text and list fields', () => {
    const cases: Array<[string, string]> = [
      ['ack:maybe', 'acknowledged is yes or no'],
      ['ack>1', 'acknowledged cannot be compared with >'],
      ['summary<=x', 'summary cannot be compared with <='],
      ['tag>=prod', 'tag cannot be compared with >='],
      ['count:', 'count needs a value'],
    ];
    for (const [query, error] of cases) expect(checkQuery(query), query).toEqual({ ok: false, error });
  });

  it('reads keywords and negation signs', () => {
    expect(tokenize('a && b || -c - d NOT e').map((t) => (t.type === 'word' ? t.text : t.type))).toEqual([
      'a',
      'and',
      'b',
      'or',
      'not',
      'c',
      '-',
      'd',
      'not',
      'e',
    ]);
  });
});
