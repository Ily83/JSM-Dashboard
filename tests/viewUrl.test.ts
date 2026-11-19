import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../src/lib/router';
import { decodeView, encodeView, hasViewParams } from '../src/lib/viewUrl';
import { DEFAULT_SORTING, EMPTY_VIEW_STATE, type ViewState } from '../src/state/views';

const rich: ViewState = {
  quick: 'critical',
  search: 'customer:"Woodgrove Bank" AND NOT tag:test — été',
  sorting: [
    { id: 'priority', desc: false },
    { id: 'createdAt', desc: true },
  ],
  filters: {
    set: {
      priority: { include: ['P1', 'P2'], exclude: [], match: 'any' },
      customer: { include: ['Contoso', 'Fabrikam'], exclude: ['Litware'], match: 'all' },
      assignee: { include: [''], exclude: [], match: 'any' },
    },
    date: {
      created: { preset: '24h', from: '', to: '' },
      updated: { preset: 'custom', from: '2026-11-01T08:00', to: '' },
    },
    text: { summary: 'disk' },
  },
};

describe('view in the address', () => {
  it('round-trips a full view state, including non-ASCII text', () => {
    const encoded = encodeView(rich);
    expect(decodeView(encoded)).toEqual(rich);
  });

  it('leaves the default view out of the address', () => {
    expect(encodeView(EMPTY_VIEW_STATE())).toBe('');
    expect(decodeView('')).toBeNull();
    expect(encodeView({ ...EMPTY_VIEW_STATE(), search: 'priority:P1' })).toBe('q=priority%3AP1');
  });

  it('marks shared links as explicit, so an unfiltered link clears filters', () => {
    const explicit = encodeView(EMPTY_VIEW_STATE(), { explicit: true });
    expect(explicit).toBe('v=1');
    expect(hasViewParams(explicit)).toBe(true);
    expect(decodeView(explicit)).toEqual(EMPTY_VIEW_STATE());
  });

  it('sanitises links: unknown fields, values, sort columns and damaged parts are dropped', () => {
    const bogus = btoa(JSON.stringify({ s: { priority: [['P1']], nonsense: [['x']] }, t: { secretField: 'x', summary: 'ok' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const state = decodeView(`quick=unknownQuick&f=${bogus}&sort=-nope,priority`)!;
    expect(state.quick).toBeNull();
    expect(Object.keys(state.filters.set)).toEqual(['priority']);
    expect(state.filters.text).toEqual({ summary: 'ok' });
    expect(state.sorting).toEqual([{ id: 'priority', desc: false }]);

    const damaged = decodeView('q=hello&f=%%%not-base64&sort=,,,')!;
    expect(damaged.search).toBe('hello');
    expect(damaged.filters).toEqual({ set: {}, date: {}, text: {} });
    expect(damaged.sorting).toEqual(DEFAULT_SORTING);

    const garbageJson = decodeView(`f=${btoa('{not json')}`)!;
    expect(garbageJson.filters).toEqual({ set: {}, date: {}, text: {} });
  });

  it('keeps the open alert next to the view parameters in the hash', () => {
    const view = encodeView(rich);
    const hash = routeHash({ page: 'alerts', section: 'critical', alertId: 'abc-123', view });
    const route = parseHash(hash);
    expect(route).toEqual({ page: 'alerts', section: 'critical', alertId: 'abc-123', view });
    expect(decodeView(route.view)).toEqual(rich);
    // Old links without view parameters still work.
    expect(parseHash('#/active?alert=xyz')).toEqual({ page: 'alerts', section: 'active', alertId: 'xyz', view: '' });
    expect(routeHash({ page: 'settings', section: 'all', alertId: null, view: 'q=x' })).toBe('#/settings');
  });
});
