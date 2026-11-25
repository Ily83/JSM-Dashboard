import { describe, expect, it } from 'vitest';
import type { Alert, Responder } from '../shared/types';
import { bodyErrorMessage, bodyErrorStatus } from '../server/bodyErrors';
import { fewestMissingScopes, grantedScopesBySite, requiredSiteScopes, siteWithScopes, type AccessibleResource } from '../server/oauthSites';
import { addSeenAlerts, addWindowAlerts } from '../server/services/historyAnalysis';
import { menuMove, tabWrap } from '../src/components/actions/menuKeys';
import { edgeScrollStep, rowRangeSelection } from '../src/components/table/rowSelection';
import { rankHistory, rankKeys } from '../src/lib/historyMetrics';
import { alertsOfItem, buildTableItems, type TableItem } from '../src/lib/tableItems';
import { makeAlert } from './fixtures';

/**
 * Helpers extracted for the SonarQube findings of 0.4.0. Each is checked
 * against a copy of the inline code it replaced, on generated inputs, and on
 * a few cases written out.
 */

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(next: () => number, values: readonly T[]): T => values[Math.floor(next() * values.length)];

describe('alert menu keys', () => {
  // The inline code of AlertMenu's key handler before the split.
  function oldMove(key: string, index: number, count: number): number | undefined {
    const last = count - 1;
    const moves: Record<string, number> = {
      ArrowDown: index < 0 || index === last ? 0 : index + 1,
      ArrowUp: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    return key in moves ? moves[key] : undefined;
  }
  function oldTab(index: number, count: number, backwards: boolean): number | null {
    const edge = backwards ? index <= 0 : index === count - 1;
    if (!edge) return null;
    return backwards ? count - 1 : 0;
  }

  it('moves like before for every key, position and length', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'a', 'Tab', 'PageDown']) {
      for (let count = 0; count <= 5; count += 1) {
        for (let index = -1; index < Math.max(count, 1); index += 1) {
          expect(menuMove(key, index, count), `${key} ${index}/${count}`).toBe(oldMove(key, index, count));
        }
      }
    }
  });

  it('wraps around at both ends and ignores other keys', () => {
    expect(menuMove('ArrowDown', 2, 3)).toBe(0);
    expect(menuMove('ArrowDown', -1, 3)).toBe(0);
    expect(menuMove('ArrowUp', 0, 3)).toBe(2);
    expect(menuMove('ArrowUp', -1, 3)).toBe(2);
    expect(menuMove('End', 0, 3)).toBe(2);
    expect(menuMove('x', 0, 3)).toBeUndefined();
  });

  it('keeps Tab inside pickers like before', () => {
    for (let count = 1; count <= 5; count += 1) {
      for (let index = -1; index < count; index += 1) {
        for (const backwards of [false, true]) {
          expect(tabWrap(index, count, backwards)).toBe(oldTab(index, count, backwards));
        }
      }
    }
    expect(tabWrap(2, 3, false)).toBe(0);
    expect(tabWrap(0, 3, true)).toBe(2);
    expect(tabWrap(-1, 3, true)).toBe(2);
    expect(tabWrap(1, 3, false)).toBeNull();
  });
});

describe('table row selection', () => {
  // The inline loops of AlertTable before the split: the rectangle drag, and Shift+click.
  function oldRectangle(items: TableItem[], start: number, end: number, base: Set<string>): Set<string> {
    const next = new Set(base);
    for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) {
      const item = items[i];
      if (item && item.kind !== 'lane') for (const alert of alertsOfItem(item)) next.add(alert.id);
    }
    return next;
  }
  function oldShiftRange(items: TableItem[], start: number, index: number, base: Set<string> | undefined): Set<string> {
    const next = new Set(base);
    for (let i = Math.min(start, index); i <= Math.max(start, index); i += 1) {
      if (items[i].kind !== 'lane') for (const alert of alertsOfItem(items[i])) next.add(alert.id);
    }
    return next;
  }
  function oldStep(clientY: number, rect: { top: number; bottom: number }): number {
    let step = 0;
    if (clientY < rect.top + 32 + 32) step = -12;
    else if (clientY > rect.bottom - 32) step = 12;
    return step;
  }

  const alerts: Alert[] = Array.from({ length: 12 }, (_, i) =>
    makeAlert({ id: `a${i}`, customers: [['Contoso'], ['Fabrikam'], ['Contoso', 'Fabrikam'], []][i % 4], alias: i % 3 === 0 ? 'disk' : `x${i}`, createdAt: i }),
  );
  const layouts: TableItem[][] = [
    buildTableItems(alerts, { laneBy: 'off', groupRepeats: false, expanded: new Set(), collapsedLanes: new Set() }),
    buildTableItems(alerts, { laneBy: 'customer', groupRepeats: true, expanded: new Set(), collapsedLanes: new Set() }),
    buildTableItems(alerts, { laneBy: 'customer', groupRepeats: false, expanded: new Set(), collapsedLanes: new Set() }),
  ];

  it('selects the same alerts as before, either way round, with or without a base', () => {
    const next = random(40);
    for (const items of layouts) {
      for (let run = 0; run < 200; run += 1) {
        const start = Math.floor(next() * items.length);
        const end = Math.floor(next() * (items.length + 3)) - 1;
        const base = new Set(alerts.filter(() => next() < 0.3).map((alert) => alert.id));
        expect([...rowRangeSelection(items, start, end, base)]).toEqual([...oldRectangle(items, start, end, base)]);
        const index = Math.floor(next() * items.length);
        const withBase = next() < 0.5 ? base : undefined;
        expect([...rowRangeSelection(items, start, index, withBase)]).toEqual([...oldShiftRange(items, start, index, withBase)]);
      }
    }
  });

  it('adds nothing for lane headers and keeps the base', () => {
    const items = layouts[2];
    const lane = items.findIndex((item) => item.kind === 'lane');
    expect(rowRangeSelection(items, lane, lane, new Set(['kept']))).toEqual(new Set(['kept']));
    expect(rowRangeSelection(items, 0, items.length - 1).size).toBe(alerts.length);
  });

  it('scrolls at the same edges as before', () => {
    const rect = { top: 100, bottom: 500 };
    for (let y = 0; y <= 600; y += 0.5) {
      expect(edgeScrollStep(y, rect.top + 32, rect.bottom)).toBe(oldStep(y, rect));
    }
    expect(edgeScrollStep(163, 132, 500)).toBe(-12);
    expect(edgeScrollStep(164, 132, 500)).toBe(0);
    expect(edgeScrollStep(469, 132, 500)).toBe(12);
  });
});

describe('request body errors', () => {
  // The inline code of the API's error handler before the split.
  function oldAnswer(error: unknown): { status: number; message: string } | null {
    const status = typeof error === 'object' && error !== null && 'type' in error && 'status' in error ? error.status : null;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      let message = 'The request body is not valid.';
      if (status === 413) message = 'The request is too large.';
      else if (status === 415) message = 'Unsupported request encoding.';
      return { status, message };
    }
    return null;
  }
  function newAnswer(error: unknown): { status: number; message: string } | null {
    const status = bodyErrorStatus(error);
    return status === null ? null : { status, message: bodyErrorMessage(status) };
  }

  it('answers the same as before', () => {
    const errors: unknown[] = [
      null, undefined, 'text', 400, new Error('x'),
      { type: 'entity.parse.failed', status: 400 },
      { type: 'entity.too.large', status: 413 },
      { type: 'encoding.unsupported', status: 415 },
      { type: 'x', status: 399 }, { type: 'x', status: 499 }, { type: 'x', status: 500 }, { type: 'x', status: '400' },
      { type: 'x', status: Number.NaN }, { status: 400 }, { type: 'x' },
      Object.assign(new Error('parse'), { type: 'entity.parse.failed', status: 400 }),
    ];
    for (const error of errors) expect(newAnswer(error)).toEqual(oldAnswer(error));
    expect(newAnswer({ type: 'entity.too.large', status: 413 })).toEqual({ status: 413, message: 'The request is too large.' });
  });
});

describe('OAuth site checks', () => {
  const SITE = 'https://example.atlassian.net';
  const SCOPES = ['read:ops-alert:jira-service-management', 'read:ops-config:jira-service-management', 'write:ops-alert:jira-service-management', 'read:jira-user'];

  // The inline code of the OAuth callback before the split.
  function oldCheck(resources: AccessibleResource[], cloudId: string | null, siteScopes: string[], tokenScope: string | undefined) {
    const bySiteId = new Map<string, Set<string>>();
    for (const resource of resources) {
      if (resource.url.replace(/\/$/, '') !== SITE || (cloudId && resource.id !== cloudId)) continue;
      const granted = bySiteId.get(resource.id) ?? new Set<string>();
      for (const scope of resource.scopes) granted.add(scope);
      bySiteId.set(resource.id, granted);
    }
    const tokenScopes = new Set(tokenScope?.split(/\s+/));
    const requiredForSite = siteScopes.filter(scope => !(
      scope.includes(':ops-') && scope.endsWith(':jira-service-management') && tokenScopes.has(scope)
    ));
    const siteId = [...bySiteId].find(([, granted]) => requiredForSite.every(scope => granted.has(scope)))?.[0];
    // The old code reduced the sites without a start value: the first site that misses the fewest scopes.
    let missing: string[] | null = null;
    if (!siteId) {
      for (const granted of bySiteId.values()) {
        const lacking = requiredForSite.filter(scope => !granted.has(scope));
        if (missing === null || lacking.length < missing.length) missing = lacking;
      }
    }
    return { sites: [...bySiteId].map(([id, granted]) => [id, [...granted]]), requiredForSite, siteId, missing };
  }
  function newCheck(resources: AccessibleResource[], cloudId: string | null, siteScopes: string[], tokenScope: string | undefined) {
    const bySiteId = grantedScopesBySite(resources, SITE, cloudId);
    const requiredForSite = requiredSiteScopes(siteScopes, new Set(tokenScope?.split(/\s+/)));
    const siteId = siteWithScopes(bySiteId, requiredForSite);
    const missing = !siteId && bySiteId.size > 0 ? fewestMissingScopes(bySiteId, requiredForSite) : null;
    return { sites: [...bySiteId].map(([id, granted]) => [id, [...granted]]), requiredForSite, siteId, missing };
  }

  it('picks the same site and reports the same missing scopes as before', () => {
    const next = random(169);
    const ids = ['a436e1a4-ba3c-4b58-8a7f-2a44a4c7c1c1', 'b436e1a4-ba3c-4b58-8a7f-2a44a4c7c1c2', 'c436e1a4-ba3c-4b58-8a7f-2a44a4c7c1c3'];
    const urls = [SITE, `${SITE}/`, 'https://other.atlassian.net'];
    for (let run = 0; run < 500; run += 1) {
      const resources = Array.from({ length: Math.floor(next() * 4) }, () => ({
        id: pick(next, ids),
        url: pick(next, urls),
        scopes: SCOPES.filter(() => next() < 0.6),
      }));
      const cloudId = next() < 0.3 ? pick(next, ids) : null;
      const siteScopes = SCOPES.filter(() => next() < 0.8);
      const tokenScope = next() < 0.5 ? SCOPES.filter(() => next() < 0.5).join(' ') : undefined;
      expect(newCheck(resources, cloudId, siteScopes, tokenScope)).toEqual(oldCheck(resources, cloudId, siteScopes, tokenScope));
    }
  });

  it('combines the products of one site and keeps the first site that misses the fewest scopes', () => {
    const one = '11111111-1111-4111-8111-111111111111';
    const two = '22222222-2222-4222-8222-222222222222';
    const bySite = grantedScopesBySite(
      [
        { id: one, url: SITE, scopes: ['a'] },
        { id: one, url: `${SITE}/`, scopes: ['b'] },
        { id: two, url: SITE, scopes: ['a'] },
        { id: two, url: 'https://other.atlassian.net', scopes: ['b', 'c'] },
      ],
      SITE,
      null,
    );
    expect([...bySite].map(([id, granted]) => [id, [...granted]])).toEqual([[one, ['a', 'b']], [two, ['a']]]);
    expect(siteWithScopes(bySite, ['a', 'b'])).toBe(one);
    expect(siteWithScopes(bySite, ['a', 'b', 'c'])).toBeUndefined();
    expect(fewestMissingScopes(bySite, ['a', 'b', 'c'])).toEqual(['c']);
    expect(fewestMissingScopes(new Map([[one, new Set<string>()], [two, new Set<string>()]]), ['x'])).toEqual(['x']);
    expect(grantedScopesBySite([{ id: two, url: SITE, scopes: ['a'] }], SITE, one).size).toBe(0);
  });

  it('takes only the JSM Operations scopes from the token response', () => {
    const token = new Set(['read:ops-alert:jira-service-management', 'read:jira-user']);
    expect(requiredSiteScopes(SCOPES, token)).toEqual(['read:ops-config:jira-service-management', 'write:ops-alert:jira-service-management', 'read:jira-user']);
  });
});

describe('history window scan', () => {
  // The inline loops of HistoryAnalysisService.scanWindow before the split.
  function oldWindow(alerts: Alert[], from: number, until: number, windowAlerts: Map<string, Alert>): boolean {
    let partial = false;
    for (const alert of alerts) {
      if (alert.createdAt < from || alert.createdAt >= until || windowAlerts.has(alert.id)) partial = true;
      else windowAlerts.set(alert.id, alert);
    }
    return partial;
  }
  function oldSeen(windowAlerts: Map<string, Alert>, seen: Map<string, Alert>): boolean {
    let partial = false;
    for (const [id, alert] of windowAlerts) {
      if (seen.has(id)) partial = true;
      else seen.set(id, alert);
    }
    return partial;
  }

  it('keeps and flags the same alerts as before', () => {
    const next = random(88);
    for (let run = 0; run < 300; run += 1) {
      const page = Array.from({ length: Math.floor(next() * 8) }, () => makeAlert({ id: `a${Math.floor(next() * 10)}`, createdAt: Math.floor(next() * 20) }));
      const known = Array.from({ length: Math.floor(next() * 3) }, () => makeAlert({ id: `a${Math.floor(next() * 10)}`, createdAt: 5 }));
      const [oldMap, newMap] = [new Map(known.map((a) => [a.id, a])), new Map(known.map((a) => [a.id, a]))];
      expect(addWindowAlerts(page, 5, 15, newMap)).toBe(oldWindow(page, 5, 15, oldMap));
      expect([...newMap]).toEqual([...oldMap]);
      const seenAlerts = Array.from({ length: Math.floor(next() * 4) }, () => makeAlert({ id: `a${Math.floor(next() * 10)}` }));
      const [oldSeenMap, newSeenMap] = [new Map(seenAlerts.map((a) => [a.id, a])), new Map(seenAlerts.map((a) => [a.id, a]))];
      expect(addSeenAlerts(newMap, newSeenMap)).toBe(oldSeen(oldMap, oldSeenMap));
      expect([...newSeenMap]).toEqual([...oldSeenMap]);
    }
  });

  it('marks a window partial for alerts outside it or read twice', () => {
    const windowAlerts = new Map<string, Alert>();
    expect(addWindowAlerts([makeAlert({ id: 'in', createdAt: 5 })], 5, 10, windowAlerts)).toBe(false);
    expect(addWindowAlerts([makeAlert({ id: 'late', createdAt: 10 }), makeAlert({ id: 'ok', createdAt: 9 })], 5, 10, windowAlerts)).toBe(true);
    expect([...windowAlerts.keys()]).toEqual(['in', 'ok']);
    expect(addWindowAlerts([makeAlert({ id: 'in', createdAt: 6 })], 5, 10, windowAlerts)).toBe(true);
    const seen = new Map([['ok', makeAlert({ id: 'ok' })]]);
    expect(addSeenAlerts(windowAlerts, seen)).toBe(true);
    expect([...seen.keys()]).toEqual(['ok', 'in']);
  });
});

describe('history rankings', () => {
  // rankHistory before the split, in two parts.
  function oldKeys(a: Alert, by: 'source' | 'tag' | 'team'): Map<string, string> {
    const historyTags = (alert: Alert) => alert.historyFields?.tags ?? alert.tags;
    const historySource = (alert: Alert) => alert.rawSource ?? alert.source;
    const keys = new Map<string, string>();
    if (by === 'source') keys.set(historySource(a), historySource(a));
    else if (by === 'tag') for (const tag of historyTags(a)) keys.set(tag, tag);
    else for (const r of a.responders) if (r.type === 'team') keys.set(r.id, r.name ?? r.id);
    return keys;
  }
  function oldRank(alerts: Alert[], by: 'source' | 'tag' | 'team') {
    const groups = new Map<string, { label: string; alerts: Alert[] }>();
    for (const a of alerts) {
      const keys = oldKeys(a, by);
      if (!keys.size) keys.set('', by === 'tag' ? 'No tags' : 'No team responder');
      for (const [key, label] of keys) {
        if (!groups.has(key)) groups.set(key, { label, alerts: [] });
        groups.get(key)!.alerts.push(a);
      }
    }
    return [...groups].map(([key, group]) => ({ key, label: group.label, ids: group.alerts.map((a) => a.id) }));
  }

  it('ranks the same bars as before', () => {
    const next = random(39);
    const responders: Responder[] = [
      { id: 't1', type: 'team', name: 'Ops' },
      { id: 't1', type: 'team', name: 'Ops renamed' },
      { id: 't2', type: 'team' },
      { id: 'u1', type: 'user', name: 'Kim' },
    ];
    for (let run = 0; run < 200; run += 1) {
      const alerts = Array.from({ length: Math.floor(next() * 10) }, (_, i) =>
        makeAlert({
          id: `a${i}`,
          rawSource: next() < 0.5 ? null : pick(next, ['Zabbix', 'Grafana']),
          source: pick(next, ['Azure Monitor', 'Zabbix']),
          tags: ['db', 'web', 'db', 'net'].filter(() => next() < 0.4),
          historyFields: next() < 0.3 ? { tags: ['hist'], properties: {} } : undefined,
          responders: responders.filter(() => next() < 0.4),
        }),
      );
      for (const by of ['source', 'tag', 'team'] as const) {
        const ranked = rankHistory(alerts, by).map((entry) => ({ key: entry.key, label: entry.label, ids: entry.alerts.map((a) => a.id) }));
        const expected = oldRank(alerts, by).sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
        expect(ranked).toEqual(expected);
      }
    }
  });

  it('labels the bars an alert counts in', () => {
    const alert = makeAlert({ id: 'a', tags: ['db', 'db', 'web'], responders: [{ id: 't1', type: 'team', name: 'Ops' }, { id: 't1', type: 'team', name: 'Ops 2' }, { id: 't2', type: 'team' }] });
    expect([...rankKeys(alert, 'tag')]).toEqual([['db', 'db'], ['web', 'web']]);
    expect([...rankKeys(alert, 'team')]).toEqual([['t1', 'Ops 2'], ['t2', 't2']]);
    expect([...rankKeys(alert, 'source')]).toEqual([['Azure Monitor', 'Azure Monitor']]);
    expect([...rankKeys(makeAlert({ id: 'b' }), 'tag')]).toEqual([['', 'No tags']]);
    expect([...rankKeys(makeAlert({ id: 'b' }), 'team')]).toEqual([['', 'No team responder']]);
  });
});
