import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { computeStats } from '../src/lib/stats';

function alert(id: string, patch: Partial<Alert> = {}): Alert {
  return {
    id,
    tinyId: null,
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
    source: 'Test source',
    rawSource: null,
    integrationName: null,
    integrationType: null,
    createdAt: 0,
    updatedAt: 0,
    lastOccurredAt: null,
    ackTime: null,
    closeTime: null,
    snoozedUntil: null,
    count: 1,
    url: null,
    ...patch,
  };
}

describe('computeStats', () => {
  it('ranks active alerts by tag once per alert and excludes closed alerts', () => {
    const stats = computeStats([
      alert('1', { priority: 'P1', tags: ['prod', 'prod', 'database'] }),
      alert('2', { tags: ['prod'] }),
      alert('3', { status: 'closed', tags: ['retired'] }),
    ]);

    expect(stats.tags).toEqual([
      { name: 'prod', count: 2, critical: 1 },
      { name: 'database', count: 1, critical: 1 },
    ]);
  });
});
