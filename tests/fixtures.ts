import type { Alert } from '../shared/types';

/** A complete list alert with neutral defaults, for unit tests. */
export function makeAlert(overrides: Partial<Alert> & { id: string }): Alert {
  return {
    tinyId: null,
    alias: null,
    summary: 'Something happened',
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
    source: 'Azure Monitor',
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
    ...overrides,
  };
}
