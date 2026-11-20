import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/lib/stats';
import { makeAlert } from './fixtures';

describe('computeStats counters', () => {
  it('counts urgency, waiting and unassigned alerts, and lists the waiting P1/P2 alerts oldest first', () => {
    const stats = computeStats([
      makeAlert({ id: '1', priority: 'P1', createdAt: 30 }),
      makeAlert({ id: '2', priority: 'P1', status: 'acked', acknowledged: true, assignee: 'Priya Nair', createdAt: 10 }),
      makeAlert({ id: '3', priority: 'P2', createdAt: 20, assignee: 'Priya Nair' }),
      makeAlert({ id: '4', priority: 'P2', status: 'snoozed', createdAt: 5 }),
      makeAlert({ id: '5', priority: 'P3', createdAt: 1 }),
      makeAlert({ id: '6', priority: 'P1', status: 'closed', createdAt: 0 }),
    ]);
    expect(stats).toMatchObject({
      active: 5,
      open: 3,
      acked: 1,
      snoozed: 1,
      critical: 2,
      criticalUnacked: 1,
      high: 2,
      highUnacked: 1,
      unassigned: 3,
      unassignedUrgent: 2,
      byPriority: { P1: 2, P2: 2, P3: 1, P4: 0, P5: 0 },
    });
    expect(stats.attention.map((a) => a.id)).toEqual(['3', '1']);
  });

  it('ranks customers, services and sources with their P1 share', () => {
    const stats = computeStats([
      makeAlert({ id: '1', priority: 'P1', customers: ['Contoso', 'Fabrikam'], service: 'AKS', source: 'Datadog' }),
      makeAlert({ id: '2', customers: ['Contoso'], service: 'AKS' }),
      makeAlert({ id: '3', customers: ['Fabrikam'], source: 'Datadog' }),
    ]);
    expect(stats.customers).toEqual([
      { name: 'Contoso', count: 2, critical: 1 },
      { name: 'Fabrikam', count: 2, critical: 1 },
    ]);
    expect(stats.services).toEqual([{ name: 'AKS', count: 2, critical: 1 }]);
    expect(stats.sources).toEqual([
      { name: 'Datadog', count: 2, critical: 1 },
      { name: 'Azure Monitor', count: 1, critical: 0 },
    ]);
  });
});
