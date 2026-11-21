import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { DEFAULT_ANALYSIS_SETTINGS } from '../src/lib/historyBreakdowns';
import { dailyHistory, filterAnalysis, rankHistory } from '../src/lib/historyMetrics';
import { sanitizeInvestigation } from '../src/state/historyInvestigations';

const date = (day: number, hour = 0) => Date.UTC(2026, 10, day, hour);
const alert = (id: string, fields: Partial<Alert> = {}) => ({
  id, createdAt: date(1), closeTime: null, summary: 'CPU is elevated', status: 'open', priority: 'P1',
  customers: ['Acme'], tags: ['cpu'], rawSource: 'ELK', integrationName: 'Webhook', responders: [], ...fields,
}) as Alert;

describe('historical metrics', () => {
  it('combines filters, deduplicates results, and calls out absent properties', () => {
    const a = alert('a', { historyFields: { tags: ['cpu', 'customer:Acme'], properties: { hostname: 'web-prod' } } });
    const b = alert('b', { rawSource: 'Manual' });
    const c = alert('c', { summary: 'Test CPU is elevated', historyFields: { tags: ['cpu'], properties: { hostname: 'web-prod' } } });
    const result = filterAnalysis([{ key: '2026-11', from: '2026-11-01', to: '2026-11-02', partial: false, alerts: [a, a, b, c] }], {
      ...DEFAULT_ANALYSIS_SETTINGS(), tag: 'cpu', excludeSource: 'Manual', integration: 'Webhook', excludeMessage: 'test',
      status: 'open', priority: 'P1', propertyKey: 'hostname', propertyValue: 'prod',
    });
    expect(result.months[0].alerts.map(row => row.id)).toEqual(['a']);
    expect(result.incomplete).toBe(true);
  });

  it('counts distinct team and raw tag memberships and does not use integration names as source when source exists', () => {
    const team = { id: 't1', type: 'team' as const, name: 'Team one' };
    const a = alert('a', { responders: [team, team, { id: 't2', type: 'team' }], historyFields: { tags: ['cpu', 'cpu', 'customer:Acme'], properties: null } });
    expect(rankHistory([a], 'team').map(row => [row.key, row.count])).toEqual([['t2', 1], ['t1', 1]]);
    expect(rankHistory([a], 'tag').map(row => row.key)).toEqual(['cpu', 'customer:Acme']);
    expect(rankHistory([a], 'source')[0].label).toBe('ELK');
  });

  it('uses UTC creation and closure separately, includes zero days, and never guesses a close timestamp', () => {
    const a = alert('a', { createdAt: date(1, 23), closeTime: date(2), status: 'closed' });
    const b = alert('b', { status: 'closed' });
    const c = alert('c', { status: 'closed', createdAt: date(2), closeTime: date(1) });
    const result = dailyHistory([a, b, c], '2026-11-01', '2026-11-03');
    expect(result.days.map(day => [day.created.length, day.closed.length])).toEqual([[2, 0], [1, 1], [0, 0]]);
    expect(result.missing).toBe(2);
  });

  it('restores advanced settings and ignores unsupported options in saved investigations', () => {
    expect(sanitizeInvestigation({
      id: 'old', from: '2026-11-01', to: '2026-11-03', breakdown: 'daily', dayBy: 'status', rankBy: 'invalid',
      excludeSource: ' Manual ', priority: 'P2', propertyKey: 'service',
    })).toMatchObject({ breakdown: 'daily', dayBy: 'status', excludeSource: 'Manual', priority: 'P2', propertyKey: 'service' });
  });
});
