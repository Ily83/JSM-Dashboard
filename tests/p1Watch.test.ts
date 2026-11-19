import { beforeEach, describe, expect, it } from 'vitest';
import { arrivingP1, claimAlarms, releaseAlarms, watchedP1 } from '../src/lib/p1Watch';
import { setPreferenceStorage, type PreferenceStorage } from '../src/lib/storage';
import { makeAlert } from './fixtures';

function memoryStorage(): PreferenceStorage {
  const data = new Map<string, unknown>();
  return {
    read: (key) => data.get(key),
    write: (key, value) => void data.set(key, JSON.parse(JSON.stringify(value))),
    remove: (key) => void data.delete(key),
  };
}

const p1 = (id: string, extra: Parameters<typeof makeAlert>[0] extends infer T ? Partial<T> : never = {}) => makeAlert({ id, priority: 'P1', ...extra });

describe('P1 alarm detection', () => {
  it('watches only open or acknowledged P1 alerts', () => {
    const ids = watchedP1([
      p1('open'),
      p1('acked', { status: 'acked', acknowledged: true }),
      p1('snoozed', { status: 'snoozed' }),
      p1('closed', { status: 'closed' }),
      makeAlert({ id: 'p2', priority: 'P2' }),
    ]);
    expect([...ids].sort()).toEqual(['acked', 'open']);
  });

  it('announces nothing on the first load', () => {
    expect(arrivingP1(null, [p1('a'), p1('b')]).arrived).toEqual([]);
  });

  it('announces new P1 alerts, alerts raised to P1 and P1 alerts back from snooze, newest first', () => {
    const before = [p1('old'), makeAlert({ id: 'raised', priority: 'P3' }), p1('napping', { status: 'snoozed' })];
    const { watched } = arrivingP1(null, before);
    const after = [
      p1('old'),
      makeAlert({ id: 'raised', priority: 'P1', createdAt: 10 }),
      p1('napping', { createdAt: 5 }),
      p1('new', { createdAt: 20 }),
      makeAlert({ id: 'new-p2', priority: 'P2' }),
    ];
    expect(arrivingP1(watched, after).arrived.map((a) => a.id)).toEqual(['new', 'raised', 'napping']);
  });

  it('does not announce acknowledging or closing', () => {
    const { watched } = arrivingP1(null, [p1('a')]);
    expect(arrivingP1(watched, [p1('a', { status: 'acked', acknowledged: true })]).arrived).toEqual([]);
    expect(arrivingP1(watched, [p1('a', { status: 'closed' })]).arrived).toEqual([]);
  });
});

describe('one alarm per alert across tabs', () => {
  beforeEach(() => setPreferenceStorage(memoryStorage()));

  it('lets only the first tab announce an alert, until it leaves and comes back', () => {
    const alert = p1('x');
    expect(claimAlarms([alert], 1000)).toHaveLength(1);
    expect(claimAlarms([alert], 2000)).toHaveLength(0);
    releaseAlarms(['x']);
    expect(claimAlarms([alert], 3000)).toHaveLength(1);
  });

  it('forgets claims after a day', () => {
    const alert = p1('y');
    claimAlarms([alert], 0);
    expect(claimAlarms([alert], 24 * 3_600_000 + 1)).toHaveLength(1);
  });
});
