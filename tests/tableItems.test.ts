import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { activityLevel, HOUR_MS, hourlyActivity } from '../src/lib/activity';
import { alertsOfItem, buildTableItems, groupItemKey, itemKey, type BuildOptions, type TableItem } from '../src/lib/tableItems';
import { makeAlert } from './fixtures';

const base: BuildOptions = { laneBy: 'off', groupRepeats: false, expanded: new Set(), collapsedLanes: new Set() };

const sorted: Alert[] = [
  makeAlert({ id: 'a', priority: 'P2', customers: ['Contoso', 'Fabrikam'], alias: 'disk', service: 'Storage' }),
  makeAlert({ id: 'b', priority: 'P1', customers: ['Fabrikam'], alias: 'aks', service: 'AKS', responders: [{ id: 't', type: 'team', name: 'Platform' }] }),
  makeAlert({ id: 'c', priority: 'P3', customers: [], alias: 'disk', service: 'Storage' }),
  makeAlert({ id: 'd', priority: 'P3', customers: ['Contoso'], alias: 'disk', service: null }),
];

const describeItem = (item: TableItem) =>
  item.kind === 'lane' ? `lane:${item.name}(${item.alerts.length})` : item.kind === 'group' ? `group:${item.group.records}` : `${item.child ? '  ' : ''}${item.alert.id}${item.alsoIn ? `+${item.alsoIn}` : ''}`;

describe('table rows with lanes and groups', () => {
  it('without lanes or grouping, keeps the sorted alerts as they are', () => {
    expect(buildTableItems(sorted, base).map(describeItem)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('splits by customer: most urgent lane first, "none" last, shared alerts marked', () => {
    const items = buildTableItems(sorted, { ...base, laneBy: 'customer' });
    expect(items.map(describeItem)).toEqual(['lane:Fabrikam(2)', 'a+Contoso', 'b', 'lane:Contoso(2)', 'a+Fabrikam', 'd', 'lane:No customer(1)', 'c']);
    const fabrikam = items[0] as Extract<TableItem, { kind: 'lane' }>;
    expect(fabrikam).toMatchObject({ priority: 'P1', p1: 1, shared: 1, isNone: false });
    // Keys stay unique although alert "a" is listed twice.
    const keys = items.map(itemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('splits by service and by team', () => {
    expect(buildTableItems(sorted, { ...base, laneBy: 'service' }).map(describeItem)).toEqual(['lane:AKS(1)', 'b', 'lane:Storage(2)', 'a', 'c', 'lane:No service(1)', 'd']);
    expect(buildTableItems(sorted, { ...base, laneBy: 'team' }).map(describeItem)).toEqual(['lane:Platform(1)', 'b', 'lane:No team(3)', 'a', 'c', 'd']);
  });

  it('collapses lanes and keeps their alerts selectable through the header', () => {
    const fabrikamKey = 'Fabrikam';
    const items = buildTableItems(sorted, { ...base, laneBy: 'customer', collapsedLanes: new Set([fabrikamKey]) });
    expect(items.map(describeItem)).toEqual(['lane:Fabrikam(2)', 'lane:Contoso(2)', 'a+Fabrikam', 'd', 'lane:No customer(1)', 'c']);
    expect(alertsOfItem(items[0]!).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('groups repeats inside each lane, with expansion keys per lane', () => {
    const grouped = buildTableItems(sorted, { ...base, groupRepeats: true });
    expect(grouped.map(describeItem)).toEqual(['group:3', 'b']);

    const inLanes = buildTableItems(sorted, { ...base, laneBy: 'customer', groupRepeats: true });
    expect(inLanes.map(describeItem)).toEqual(['lane:Fabrikam(2)', 'a+Contoso', 'b', 'lane:Contoso(2)', 'group:2', 'lane:No customer(1)', 'c']);

    const key = groupItemKey('Contoso', 'alias:disk');
    const expanded = buildTableItems(sorted, { ...base, laneBy: 'customer', groupRepeats: true, expanded: new Set([key]) });
    expect(expanded.map(describeItem)).toEqual(['lane:Fabrikam(2)', 'a+Contoso', 'b', 'lane:Contoso(2)', 'group:2', '  a+Fabrikam', '  d', 'lane:No customer(1)', 'c']);
  });
});

describe('24-hour activity strip', () => {
  const end = Date.parse('2026-11-19T12:30:00Z');
  const lastHourStart = Date.parse('2026-11-19T12:00:00Z');

  it('counts created and re-occurring alerts per clock hour', () => {
    const alerts = [
      makeAlert({ id: '1', createdAt: lastHourStart + 5 * 60_000 }),
      makeAlert({ id: '2', createdAt: lastHourStart + 10 * 60_000 }),
      makeAlert({ id: '3', createdAt: lastHourStart - 3 * HOUR_MS, lastOccurredAt: lastHourStart + 20 * 60_000 }),
      makeAlert({ id: '4', createdAt: lastHourStart - 30 * HOUR_MS }), // older than 24 h
      makeAlert({ id: '5', createdAt: lastHourStart - 2 * HOUR_MS, lastOccurredAt: lastHourStart - 2 * HOUR_MS + 1000 }), // same moment: no repeat
    ];
    const activity = hourlyActivity(alerts, end);
    expect(activity.start).toBe(Date.parse('2026-11-18T13:00:00Z'));
    expect(activity.created[23]).toBe(2);
    expect(activity.recurred[23]).toBe(1);
    expect(activity.created[20]).toBe(1);
    expect(activity.created[21]).toBe(1);
    expect(activity.created.reduce((a, b) => a + b, 0)).toBe(4);
    expect(activity.max).toBe(3);
  });

  it('maps counts to five shades', () => {
    expect([0, 1, 2, 3, 4, 8].map((v) => activityLevel(v, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(activityLevel(1, 0)).toBe(0);
  });
});
