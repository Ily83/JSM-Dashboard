import { useSyncExternalStore } from 'react';
import { isSectionId, type SectionId } from '../config/sections';

/**
 * Hash-based routing: "#/active?q=…&alert=<id>". Section, view state (see
 * src/lib/viewUrl.ts) and the open alert are part of the URL, so the back
 * button, bookmarks and shared links work, and no server-side routing is
 * needed.
 */
export interface Route {
  page: 'alerts' | 'settings' | 'history';
  section: SectionId;
  alertId: string | null;
  /** View parameters as a query string (everything except `alert`); '' when none. */
  view: string;
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  if (path === 'settings' || path === 'history') return { page: path, section: 'all', alertId: null, view: '' };
  const params = new URLSearchParams(query);
  const alertId = params.get('alert');
  params.delete('alert');
  return {
    page: 'alerts',
    section: isSectionId(path) ? path : 'all',
    alertId: alertId && /^[A-Za-z0-9._-]{1,128}$/.test(alertId) ? alertId : null,
    view: params.toString(),
  };
}

/** The hash for a route: view parameters first, then the open alert. */
export function routeHash(route: Route): string {
  if (route.page !== 'alerts') return `#/${route.page}`;
  const params = new URLSearchParams(route.view);
  if (route.alertId) params.set('alert', route.alertId);
  const query = params.toString();
  const search = query ? `?${query}` : '';
  return `#/${route.section}${search}`;
}

// Guarded so modules that import the router can also be loaded by unit tests.
const initialHash = globalThis.window === undefined ? '' : globalThis.location.hash;
let cached: Route = parseHash(initialHash);
let cachedHash = initialHash;

function snapshot(): Route {
  if (globalThis.location.hash !== cachedHash) {
    cachedHash = globalThis.location.hash;
    cached = parseHash(cachedHash);
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  globalThis.addEventListener('hashchange', listener);
  return () => globalThis.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(next: Partial<Route>, options: { replace?: boolean } = {}): void {
  const route = { ...snapshot(), ...next };
  const hash = routeHash(route);
  if (hash === globalThis.location.hash) return;
  if (options.replace) {
    globalThis.history.replaceState(null, '', hash);
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    globalThis.location.hash = hash;
  }
}
