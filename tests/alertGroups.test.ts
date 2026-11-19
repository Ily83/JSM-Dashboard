import { describe, expect, it } from 'vitest';
import { groupAlerts, groupKey, groupSummaryAlert, normaliseSummary, rankGroups } from '../src/lib/alertGroups';
import { makeAlert } from './fixtures';

describe('normaliseSummary', () => {
  it('replaces numbers, uuids and hex ids and collapses spaces', () => {
    expect(normaliseSummary('Disk  91.5% on vm-12 [00012]')).toBe('disk #% on vm-# [#]');
    expect(normaliseSummary('Job 9b251e07-73c9-4907-9996-8cb53a6a20d0 failed')).toBe('job # failed');
    expect(normaliseSummary('Commit deadbeef42 broke build')).toBe('commit # broke build');
  });

  it('keeps ordinary words made of hex letters', () => {
    expect(normaliseSummary('Database facade added')).toBe('database facade added');
  });
});

describe('groupKey', () => {
  it('uses the alias, and falls back to source and summary when the alias is missing or only repeats the id', () => {
    expect(groupKey(makeAlert({ id: 'a', alias: 'db-lag' }))).toEqual({ key: 'alias:db-lag', basis: 'alias' });
    expect(groupKey(makeAlert({ id: 'a', alias: 'a', summary: 'CPU 90%' })).basis).toBe('summary');
    expect(groupKey(makeAlert({ id: 'a', alias: 'db-lag', summary: 'CPU 90%' }), 'summary')).toEqual({
      key: 'summary:azure monitor|cpu #%',
      basis: 'summary',
    });
  });
});

describe('groupAlerts and rankGroups', () => {
  const alerts = [
    makeAlert({ id: '1', alias: 'x', summary: 'Old x', createdAt: 10, count: 3, priority: 'P2', customers: ['Fabrikam'] }),
    makeAlert({ id: '2', alias: 'x', summary: 'New x', createdAt: 30, count: 2, priority: 'P1', customers: ['Contoso'] }),
    makeAlert({ id: '3', summary: 'Disk 91% on vm-1', createdAt: 20, count: 10 }),
    makeAlert({ id: '4', summary: 'Disk 95% on vm-2', createdAt: 25, count: 1 }),
    makeAlert({ id: '5', summary: 'Disk 95% on vm-2', source: 'Other', createdAt: 5 }),
  ];

  it('keeps records and occurrences apart and summarises each group', () => {
    const groups = groupAlerts(alerts);
    expect(groups.map((g) => g.key)).toEqual(['alias:x', 'summary:azure monitor|disk #% on vm-#', 'summary:other|disk #% on vm-#']);
    const [x, disk] = groups;
    expect(x).toMatchObject({ records: 2, occurrences: 5, p1: 1, priority: 'P1', label: 'New x', firstCreatedAt: 10, lastCreatedAt: 30 });
    expect(x!.customers).toEqual(['Contoso', 'Fabrikam']);
    expect(disk).toMatchObject({ records: 2, occurrences: 11, p1: 0 });
  });

  it('ranks by records, then occurrences, then recency', () => {
    expect(rankGroups(groupAlerts(alerts)).map((g) => g.key)).toEqual([
      'summary:azure monitor|disk #% on vm-#',
      'alias:x',
      'summary:other|disk #% on vm-#',
    ]);
  });
});

describe('groupSummaryAlert', () => {
  it('builds one row from the newest alert with group-wide figures', () => {
    const [group] = groupAlerts([
      makeAlert({ id: '1', alias: 'x', createdAt: 10, updatedAt: 50, status: 'closed', acknowledged: true, assignee: 'Ann', tags: ['a'], count: 4 }),
      makeAlert({ id: '2', alias: 'x', createdAt: 30, updatedAt: 31, status: 'acked', acknowledged: true, assignee: 'Bob', tags: ['b'], priority: 'P1' }),
    ]);
    const row = groupSummaryAlert(group!);
    expect(row).toMatchObject({ id: 'group:alias:x', tinyId: null, priority: 'P1', status: 'acked', acknowledged: true, assignee: null, updatedAt: 50, count: 5, createdAt: 30, url: null });
    expect(row.tags).toEqual(['a', 'b']);
  });
});
