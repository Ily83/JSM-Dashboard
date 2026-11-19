import { describe, expect, it } from 'vitest';
import { formatDuration, percentile, responseBreakdown, responseStats } from '../src/lib/responseTimes';
import { makeAlert } from './fixtures';

const T = Date.parse('2026-11-01T00:00:00Z');
const M = 60_000;

const alerts = [
  makeAlert({ id: 'a', priority: 'P1', customers: ['Contoso'], alias: 'x', createdAt: T, ackTime: T + 2 * M, closeTime: T + 30 * M }),
  makeAlert({ id: 'b', priority: 'P1', customers: ['Contoso', 'Fabrikam'], alias: 'x', createdAt: T, ackTime: T + 4 * M, closeTime: T + 60 * M }),
  makeAlert({ id: 'c', priority: 'P1', customers: ['Fabrikam'], alias: 'y', createdAt: T, ackTime: T + 10 * M, closeTime: null }),
  makeAlert({ id: 'd', priority: 'P3', customers: [], alias: 'y', createdAt: T, ackTime: null, closeTime: T + 120 * M }),
  // A clock-skewed record (acknowledged "before" creation) is left out, not counted as negative.
  makeAlert({ id: 'e', priority: 'P3', customers: [], alias: 'z', createdAt: T, ackTime: T - M, closeTime: null }),
];

describe('time to acknowledge and close', () => {
  it('computes median and 90th percentile with linear interpolation', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([0, 10], 0.9)).toBe(9);
  });

  it('leaves out alerts without the timestamp, and counts them', () => {
    const stats = responseStats(alerts);
    expect(stats.alerts).toBe(5);
    expect(stats.ack).toEqual({ count: 3, missing: 2, median: 4 * M, p90: 8.8 * M });
    expect(stats.close.count).toBe(3);
    expect(stats.close.missing).toBe(2);
    expect(stats.close.median).toBe(60 * M);
  });

  it('breaks down per priority, per customer (each customer counts) and per alert group', () => {
    const byPriority = responseBreakdown(alerts, 'priority');
    expect(byPriority.map((r) => [r.key, r.alerts.length, r.stats.ack.median])).toEqual([
      ['P1', 3, 4 * M],
      ['P3', 2, null],
    ]);
    const byCustomer = responseBreakdown(alerts, 'customer');
    expect(byCustomer.map((r) => [r.key, r.alerts.length])).toEqual([
      ['Contoso', 2],
      ['Fabrikam', 2],
    ]);
    expect(byCustomer[0]!.stats.ack.median).toBe(3 * M);
    const byGroup = responseBreakdown(alerts, 'group');
    expect(byGroup.map((r) => [r.key, r.alerts.length])).toEqual([
      ['alias:x', 2],
      ['alias:y', 2],
      ['alias:z', 1],
    ]);
  });

  it('formats durations compactly', () => {
    expect([null, 45_000, 12 * M, 185 * M, 52 * 60 * M].map(formatDuration)).toEqual(['–', '45s', '12m', '3h 05m', '2d 4h']);
  });
});
