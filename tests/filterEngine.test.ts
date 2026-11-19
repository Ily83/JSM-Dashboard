import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { NONE } from '../src/config/filterFields';
import { SECTIONS } from '../src/config/sections';
import { EMPTY_FILTERS, buildFacets, filterAlerts, sanitizeFilters, withSet, type Filters, type ViewQuery } from '../src/lib/filterEngine';

const NOW = Date.UTC(2026, 0, 10, 12);
const HOUR = 3_600_000;

function alert(id: string, patch: Partial<Alert>): Alert {
  return {
    id,
    tinyId: id.replace(/\D/g, '') || null,
    alias: null,
    summary: `Alert ${id}`,
    priority: 'P3',
    status: 'open',
    rawStatus: 'open',
    acknowledged: false,
    customers: [],
    tags: [],
    service: null,
    entity: null,
    assignee: null,
    responders: [],
    source: 'Datadog',
    rawSource: null,
    integrationName: 'Datadog',
    integrationType: 'Datadog',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    lastOccurredAt: null,
    ackTime: null,
    closeTime: null,
    snoozedUntil: null,
    count: 1,
    url: null,
    ...patch,
  };
}

const alerts: Alert[] = [
  alert('a1', { priority: 'P1', customers: ['Contoso', 'Fabrikam'], assignee: 'Priya Nair', service: 'AKS' }),
  alert('a2', { priority: 'P2', customers: ['Contoso'], status: 'acked', acknowledged: true, tags: ['prod'] }),
  alert('a3', { priority: 'P3', customers: ['Fabrikam'], createdAt: NOW - 48 * HOUR, source: 'Zabbix' }),
  alert('a4', { priority: 'P1', status: 'closed', customers: ['Litware'], summary: 'VPN tunnel down' }),
  alert('a5', { priority: 'P4', responders: [{ id: 't1', type: 'team', name: 'Network' }] }),
];

const run = (patch: Partial<ViewQuery>) =>
  filterAlerts(alerts, {
    section: SECTIONS.all,
    quick: null,
    filters: EMPTY_FILTERS,
    search: '',
    profile: { me: 'priya nair', myCustomers: new Set(['Litware']) },
    now: NOW,
    ...patch,
  }).map((a) => a.id);

const set = (id: Parameters<typeof withSet>[1], include: string[], exclude: string[] = [], match: 'any' | 'all' = 'any'): Filters =>
  withSet(EMPTY_FILTERS, id, { include, exclude, match });

describe('filterAlerts', () => {
  it('returns everything without filters', () => expect(run({})).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']));

  it('restricts to the section', () => {
    expect(run({ section: SECTIONS.critical })).toEqual(['a1']);
    expect(run({ section: SECTIONS.resolved })).toEqual(['a4']);
    expect(run({ section: SECTIONS.acknowledged })).toEqual(['a2']);
  });

  it('matches any included value (OR) on a multi-value field', () =>
    expect(run({ filters: set('customer', ['Contoso', 'Litware']) })).toEqual(['a1', 'a2', 'a4']));

  it('matches all included values (AND) when asked', () =>
    expect(run({ filters: set('customer', ['Contoso', 'Fabrikam'], [], 'all') })).toEqual(['a1']));

  it('excludes values', () => {
    expect(run({ filters: set('customer', [], ['Fabrikam']) })).toEqual(['a2', 'a4', 'a5']);
    expect(run({ filters: set('customer', ['Contoso'], ['Fabrikam']) })).toEqual(['a2']);
  });

  it('matches the empty value', () => {
    expect(run({ filters: set('customer', [NONE]) })).toEqual(['a5']);
    expect(run({ filters: set('assignee', [NONE]) })).toEqual(['a2', 'a3', 'a4', 'a5']);
    expect(run({ filters: set('assignee', [], [NONE]) })).toEqual(['a1']);
  });

  it('combines different filters with AND', () => {
    const filters = withSet(set('priority', ['P1', 'P2']), 'acknowledged', { include: ['no'], exclude: [], match: 'any' });
    expect(run({ filters })).toEqual(['a1', 'a4']);
    expect(run({ filters, section: SECTIONS.active })).toEqual(['a1']);
  });

  it('ignores a selection the section does not allow', () =>
    expect(run({ section: SECTIONS.critical, filters: set('priority', ['P4']) })).toEqual(['a1']));

  it('filters by team and by tag', () => {
    expect(run({ filters: set('team', ['Network']) })).toEqual(['a5']);
    expect(run({ filters: set('tag', ['prod']) })).toEqual(['a2']);
  });

  it('filters by date preset and custom range', () => {
    expect(run({ filters: { ...EMPTY_FILTERS, date: { created: { preset: '24h', from: '', to: '' } } } })).toEqual(['a1', 'a2', 'a4', 'a5']);
    const from = new Date(NOW - 72 * HOUR).toISOString().slice(0, 16);
    const to = new Date(NOW - 24 * HOUR).toISOString().slice(0, 16);
    const custom = run({ filters: { ...EMPTY_FILTERS, date: { created: { preset: 'custom', from: `${from}Z`, to: `${to}Z` } } } });
    expect(custom).toEqual(['a3']);
  });

  it('filters by alert identifier', () =>
    expect(run({ filters: { ...EMPTY_FILTERS, text: { identifier: '#3' } } })).toEqual(['a3']));

  it('matches case-insensitive text in the requested column only', () => {
    expect(run({ filters: { ...EMPTY_FILTERS, text: { summary: '  VPN TUNNEL  ' } } })).toEqual(['a4']);
    expect(run({ filters: { ...EMPTY_FILTERS, text: { summary: 'Datadog' } } })).toEqual([]);
    expect(run({ filters: { ...EMPTY_FILTERS, text: { serviceText: 'ks' } } })).toEqual(['a1']);
    expect(run({ filters: { ...EMPTY_FILTERS, text: { assigneeText: 'YA NA' } } })).toEqual(['a1']);
    expect(run({ filters: { ...EMPTY_FILTERS, text: { summary: '#vpn' } } })).toEqual([]);
  });

  it('combines column text filters with existing exact filters', () => {
    const text = { serviceText: 'AK', assigneeText: 'Priya' };
    expect(run({ filters: { ...set('status', ['open']), text } })).toEqual(['a1']);
    expect(run({ filters: { ...set('status', ['closed']), text } })).toEqual([]);
  });

  it('searches several words across fields', () => {
    expect(run({ search: 'vpn litware' })).toEqual(['a4']);
    expect(run({ search: 'zabbix' })).toEqual(['a3']);
    expect(run({ search: 'nothing-matches' })).toEqual([]);
  });

  it('applies quick filters', () => {
    expect(run({ quick: 'critical' })).toEqual(['a1', 'a4']);
    expect(run({ quick: 'unacked' })).toEqual(['a1', 'a3', 'a5']);
    expect(run({ quick: 'mine' })).toEqual(['a1']);
    expect(run({ quick: 'multi' })).toEqual(['a1']);
    expect(run({ quick: 'myCustomers' })).toEqual(['a4']);
  });
});

describe('buildFacets', () => {
  it('counts values within the section and lists the empty value last', () => {
    const facets = buildFacets(alerts, SECTIONS.active);
    expect(facets.customer).toEqual([
      { value: 'Contoso', count: 2 },
      { value: 'Fabrikam', count: 2 },
      { value: NONE, count: 1 },
    ]);
    expect(facets.status.map((o) => o.value)).toEqual(['open', 'acked', 'snoozed']);
    expect(facets.priority.find((o) => o.value === 'P1')?.count).toBe(1);
  });
});

describe('sanitizeFilters', () => {
  it('drops unknown fields and malformed values', () => {
    const clean = sanitizeFilters({
      set: { customer: { include: ['A', 'A', 3], exclude: 'x', match: 'all' }, bogus: { include: ['x'] }, status: { include: [] } },
      date: { created: { preset: 'nope' }, updated: { preset: '7d' } },
      text: { identifier: 12, summary: 'timeout', serviceText: 'edge', assigneeText: 'Priya' },
    });
    expect(clean).toEqual({
      set: { customer: { include: ['A'], exclude: [], match: 'all' } },
      date: { updated: { preset: '7d', from: '', to: '' } },
      text: { summary: 'timeout', serviceText: 'edge', assigneeText: 'Priya' },
    });
    expect(sanitizeFilters(null)).toEqual(EMPTY_FILTERS);
  });
});
