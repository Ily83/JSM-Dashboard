import { describe, expect, it } from 'vitest';
import type { HistoryMonth } from '../src/lib/historyAnalysis';
import { analysisAlerts, rankCustomers, rankHotspots, rankRecurring } from '../src/lib/historyBreakdowns';
import { isInvestigationModified, sanitizeHistoryInvestigations, sanitizeInvestigation } from '../src/state/historyInvestigations';
import { makeAlert } from './fixtures';

const alerts = [
  makeAlert({ id: 'a1', alias: 'db', summary: 'DB lag', priority: 'P1', customers: ['Contoso', 'Fabrikam'], service: 'SQL', tags: ['prod'], createdAt: 100, count: 4 }),
  makeAlert({ id: 'a2', alias: 'db', summary: 'DB lag', priority: 'P2', customers: ['Contoso'], service: 'SQL', tags: ['prod'], createdAt: 200 }),
  makeAlert({ id: 'a3', alias: 'db', summary: 'DB lag', priority: 'P1', customers: ['Contoso'], service: 'SQL', tags: ['dev'], createdAt: 300 }),
  makeAlert({ id: 'a4', alias: 'vpn', summary: 'VPN down', priority: 'P1', customers: ['Fabrikam'], service: 'Network', tags: ['prod'], createdAt: 400 }),
  makeAlert({ id: 'a5', alias: 'disk', summary: 'Disk full', priority: 'P3', customers: [], service: null, tags: [], createdAt: 500 }),
];

const months: HistoryMonth[] = [
  { key: '2026-01', from: '2026-01-01', to: '2026-01-31', alerts: alerts.slice(0, 2), partial: false },
  { key: '2026-02', from: '2026-02-01', to: '2026-02-28', alerts: alerts.slice(2), partial: true },
];

describe('analysisAlerts', () => {
  it('flattens the months newest first and applies customer and tag filters together', () => {
    expect(analysisAlerts(months, '', '').map((a) => a.id)).toEqual(['a5', 'a4', 'a3', 'a2', 'a1']);
    expect(analysisAlerts(months, 'Contoso', 'prod').map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});

describe('rankRecurring', () => {
  it('ranks groups by records and keeps occurrences separate', () => {
    const [top] = rankRecurring(alerts, false);
    expect(top).toMatchObject({ key: 'alias:db', records: 3, occurrences: 6, p1: 2 });
    expect(top!.alerts.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('counts only P1 alerts with the P1-only toggle', () => {
    const ranked = rankRecurring(alerts, true);
    expect(ranked.map((g) => [g.key, g.records])).toEqual([
      ['alias:db', 2],
      ['alias:vpn', 1],
    ]);
  });
});

describe('rankCustomers', () => {
  it('counts an alert once for each affected customer and reports alerts without one', () => {
    const { entries, withoutCustomer } = rankCustomers(alerts, false);
    expect(entries.map((e) => [e.label, e.count, e.p1])).toEqual([
      ['Contoso', 3, 2],
      ['Fabrikam', 2, 2],
    ]);
    expect(entries.reduce((sum, e) => sum + e.count, 0)).toBeGreaterThan(alerts.length - withoutCustomer);
    expect(withoutCustomer).toBe(1);
    expect(entries[1]!.alerts.map((a) => a.id)).toEqual(['a4', 'a1']);
  });

  it('ranks P1 alerts only with the P1-only toggle', () => {
    const { entries, withoutCustomer } = rankCustomers(alerts, true);
    // Equal counts fall back to name order.
    expect(entries.map((e) => [e.label, e.count])).toEqual([
      ['Contoso', 2],
      ['Fabrikam', 2],
    ]);
    expect(withoutCustomer).toBe(0);
  });
});

describe('rankHotspots', () => {
  it('ranks customers by P1 alerts, with all alerts as the total', () => {
    expect(rankHotspots(alerts, 'customer').map((e) => [e.label, e.count, e.total])).toEqual([
      ['Contoso', 2, 3],
      ['Fabrikam', 2, 2],
    ]);
  });

  it('ranks services and drills down to their P1 alerts only', () => {
    const entries = rankHotspots(alerts, 'service');
    expect(entries.map((e) => [e.label, e.count])).toEqual([
      ['SQL', 2],
      ['Network', 1],
    ]);
    expect(entries[0]!.alerts.map((a) => a.id)).toEqual(['a3', 'a1']);
  });

  it('ranks alert groups and leaves out groups without P1 alerts', () => {
    const entries = rankHotspots(alerts, 'group');
    expect(entries.map((e) => [e.key, e.count, e.total])).toEqual([
      ['alias:db', 2, 3],
      ['alias:vpn', 1, 1],
    ]);
  });
});

describe('saved History investigations', () => {
  const valid = { id: 'i1', name: '  Q1 review ', from: '2026-01-01', to: '2026-03-31', customer: 'Contoso', tag: '', breakdown: 'hotspots', p1Only: true, dimension: 'service' };

  it('keeps valid entries and trims names', () => {
    expect(sanitizeInvestigation(valid)).toEqual({ ...valid, name: 'Q1 review', responseBy: 'priority' });
    expect(sanitizeInvestigation({ ...valid, breakdown: 'response', responseBy: 'customer' })).toMatchObject({ breakdown: 'response', responseBy: 'customer' });
  });

  it('drops invalid dates and duplicate ids, and repairs unknown values', () => {
    const data = sanitizeHistoryInvestigations({
      saved: [
        valid,
        { ...valid, name: 'duplicate' },
        { ...valid, id: 'i2', from: '2026-04-01' },
        { ...valid, id: 'i3', to: '2026-02-30' },
        { ...valid, id: 'i4', name: '', breakdown: 'pie', dimension: 'planet', p1Only: 'yes' },
        'garbage',
      ],
    });
    expect(data.saved.map((i) => i.id)).toEqual(['i1', 'i4']);
    expect(data.saved[1]).toMatchObject({ name: 'Untitled investigation', breakdown: 'month', dimension: 'customer', p1Only: false });
    expect(sanitizeHistoryInvestigations('nope')).toEqual({ saved: [] });
  });

  it('detects a modified investigation', () => {
    const saved = sanitizeInvestigation(valid)!;
    const { id: _id, name: _name, ...input } = saved;
    expect(isInvestigationModified(saved, input)).toBe(false);
    expect(isInvestigationModified(saved, { ...input, tag: 'prod' })).toBe(true);
  });
});
