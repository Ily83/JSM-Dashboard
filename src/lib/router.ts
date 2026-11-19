import { useSyncExternalStore } from 'react';
import { isSectionId, type SectionId } from '../config/sections';

/**
 * Hash-based routing: "#/active?alert=<id>". Sections and the open alert are
 * part of the URL, so the browser's back button and bookmarks work, and no
 * server-side routing is needed.
 */
export interface Route {
  page: 'alerts' | 'settings' | 'history';
  section: SectionId;
  alertId: string | null;
}

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  if (path === 'settings' || path === 'history') return { page: path, section: 'all', alertId: null };
  const alertId = new URLSearchParams(query).get('alert');
  return {
    page: 'alerts',
    section: isSectionId(path) ? path : 'all',
    alertId: alertId && /^[A-Za-z0-9._-]{1,128}$/.test(alertId) ? alertId : null,
  };
}

let cached: Route = parse(window.location.hash);
let cachedHash = window.location.hash;

function snapshot(): Route {
  if (window.location.hash !== cachedHash) {
    cachedHash = window.location.hash;
    cached = parse(cachedHash);
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(next: Partial<Route>, options: { replace?: boolean } = {}): void {
  const route = { ...snapshot(), ...next };
  const hash =
    route.page === 'alerts'
      ? `#/${route.section}${route.alertId ? `?alert=${encodeURIComponent(route.alertId)}` : ''}`
      : `#/${route.page}`;
  if (hash === window.location.hash) return;
  if (options.replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}
