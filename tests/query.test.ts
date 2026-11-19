import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { checkQuery, compileQuery, tokenize } from '../src/lib/query';
import { makeAlert } from './fixtures';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const H = 3_600_000;

const alerts: Alert[] = [
  makeAlert({ id: 'a1', tinyId: '101', priority: 'P1', status: 'open', summary: 'AKS API server unreachable', customers: ['Contoso', 'Fabrikam'], tags: ['prod'], service: 'AKS Platform', createdAt: NOW - 30 * 60_000, count: 7, responders: [{ id: 't1', type: 'team', name: 'Platform Engineering' }] }),
  makeAlert({ id: 'a2', tinyId: '102', priority: 'P2', status: 'acked', acknowledged: true, summary: 'Azure SQL replication lag', customers: ['Woodgrove Bank'], tags: ['prod', 'database'], service: 'Azure SQL', assignee: 'Priya Nair', createdAt: NOW - 5 * H }),
  makeAlert({ id: 'a3', tinyId: '103', priority: 'P3', status: 'closed', summary: 'Disk full on vm-erp-03', customers: [], tags: ['test'], service: null, createdAt: NOW - 3 * 24 * H, alias: 'disk-vm-erp-03' }),
  makeAlert({ id: 'a4', tinyId: '104', priority: 'P4', status: 'snoozed', summary: 'Certificate expires soon', customers: ['Contoso'], tags: [], service: 'Key Vault', createdAt: Date.parse('2026-11-01T08:00:00'), count: 1 }),
];

const searchText = (a: Alert) => [a.summary, a.customers.join(' '), a.tags.join(' '), a.service ?? '', a.assignee ?? ''].join('\n').toLowerCase();

function ids(query: string): string[] {
  const compiled = compileQuery(query, { now: NOW, searchText });
  if (!compiled.ok) throw new Error(`unexpected error for "${query}": ${compiled.error}`);
  return compiled.predicate ? alerts.filter(compiled.predicate).map((a) => a.id) : alerts.map((a) => a.id);
}

describe('query language', () => {
  it('keeps plain words working as before: every word must appear', () => {
    expect(ids('')).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(ids('azure')).toEqual(['a2']);
    expect(ids('prod contoso')).toEqual(['a1']);
    expect(ids('not responding')).toEqual([]); // "not" in lower case is a word, not a keyword
    expect(compileQuery('disk full', { now: NOW, searchText })).toMatchObject({ ok: true, structured: false });
  });

  it('matches fields case-insensitively, with AND implied between terms', () => {
    expect(ids('priority:P1')).toEqual(['a1']);
    expect(ids('PRIORITY:p1')).toEqual(['a1']);
    expect(ids('priority:P1 AND customer:Contoso')).toEqual(['a1']);
    expect(ids('customer:contoso')).toEqual(['a1', 'a4']);
    expect(ids('customer:Contoso tag:prod')).toEqual(['a1']);
    expect(ids('team:"Platform Engineering"')).toEqual(['a1']);
    expect(ids('assignee:"priya nair"')).toEqual(['a2']);
  });

  it('supports OR, NOT, "-" and parentheses with the usual precedence', () => {
    expect(ids('status:open OR status:acked')).toEqual(['a1', 'a2']);
    expect(ids('NOT tag:test')).toEqual(['a1', 'a2', 'a4']);
    expect(ids('-tag:test')).toEqual(['a1', 'a2', 'a4']);
    expect(ids('priority:P1 OR priority:P2 AND tag:database')).toEqual(['a1', 'a2']);
    expect(ids('(priority:P1 OR priority:P2) AND tag:database')).toEqual(['a2']);
    expect(ids('customer:Contoso AND NOT (status:snoozed OR status:closed)')).toEqual(['a1']);
    expect(ids('status!=closed')).toEqual(['a1', 'a2', 'a4']);
    expect(ids('priority:P1 || priority:P4')).toEqual(['a1', 'a4']);
  });

  it('accepts status words as shown in the table', () => {
    expect(ids('status:Acked')).toEqual(['a2']);
    expect(ids('status:acknowledged')).toEqual(['a2']);
    expect(ids('acknowledged:yes')).toEqual(['a2']);
    expect(ids('ack:no')).toEqual(['a1', 'a3', 'a4']);
  });

  it('supports quotes, wildcards and empty values', () => {
    expect(ids('service:"Azure SQL"')).toEqual(['a2']);
    expect(ids('customer:Con*')).toEqual(['a1', 'a4']);
    expect(ids('service:*sql*')).toEqual(['a2']);
    expect(ids('customer:""')).toEqual(['a3']);
    expect(ids('service:none')).toEqual(['a3']);
    expect(ids('assignee:none')).toEqual(['a1', 'a3', 'a4']);
    expect(ids('"replication lag"')).toEqual(['a2']);
    expect(ids('summary:disk')).toEqual(['a3']);
    expect(ids('id:#103')).toEqual(['a3']);
    expect(ids('id:disk-vm*')).toEqual(['a3']);
  });

  it('compares priorities by urgency and counts by number', () => {
    expect(ids('priority<=P2')).toEqual(['a1', 'a2']);
    expect(ids('priority>P2')).toEqual(['a3', 'a4']);
    expect(ids('count>5')).toEqual(['a1']);
    expect(ids('count=1')).toEqual(['a2', 'a3', 'a4']);
  });

  it('compares durations as age and dates as time', () => {
    expect(ids('created<2h')).toEqual(['a1']);
    expect(ids('created:6h')).toEqual(['a1', 'a2']);
    expect(ids('created>1d')).toEqual(['a3', 'a4']);
    expect(ids('created>2026-11-10')).toEqual(['a1', 'a2', 'a3']);
    expect(ids('created:2026-11-01')).toEqual(['a4']);
    expect(ids('created<2026-11-02')).toEqual(['a4']);
  });

  it('treats unknown field prefixes as plain text', () => {
    const tokens = tokenize('error:timeout');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'word', text: 'error:timeout' });
    expect(ids('aks-prod')).toEqual([]);
  });

  it('reports errors briefly and falls back to plain words', () => {
    const cases: Array<[string, RegExp]> = [
      ['priority:P9', /Unknown priority/],
      ['(priority:P1', /Missing \)/],
      ['priority:P1)', /Unexpected \)/],
      ['priority:P1 AND', /Nothing after AND/],
      ['OR priority:P1', /OR needs something before it/],
      ['NOT', /Nothing after NOT|Incomplete/],
      ['created>soon', /duration/],
      ['count>many', /number/],
      ['customer<Contoso', /cannot be compared/],
      ['service:"Azure', /closing quote/],
      ['priority:', /needs a value/],
      ['()', /Empty parentheses/],
    ];
    for (const [query, message] of cases) {
      const result = checkQuery(query);
      expect(result.ok, query).toBe(false);
      if (!result.ok) expect(result.error, query).toMatch(message);
    }
    // The list stays usable: the text is searched as words.
    const fallback = compileQuery('priority:P9', { now: NOW, searchText });
    expect(fallback.ok).toBe(false);
    expect(fallback.predicate).not.toBeNull();
  });

  it('stays fast: 20,000 alerts in well under 100 ms', () => {
    const many: Alert[] = [];
    for (let i = 0; i < 20_000; i += 1) many.push({ ...alerts[i % 4]!, id: `x${i}` });
    const compiled = compileQuery('(priority<=P2 OR tag:database) AND NOT status:closed AND customer:Con* created<1d', { now: NOW, searchText });
    expect(compiled.ok).toBe(true);
    const started = performance.now();
    const hits = many.filter(compiled.predicate!).length;
    const elapsed = performance.now() - started;
    expect(hits).toBe(5000);
    expect(elapsed).toBeLessThan(100);
  });
});
