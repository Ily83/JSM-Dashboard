import { useSyncExternalStore } from 'react';
import { getPreferenceStorage } from './storage';

/**
 * Small state container persisted through the preference storage adapter.
 *
 * Preferences live outside React state so that a change (for example a column
 * being resized) re-renders only the components that subscribe to that store,
 * not the whole application.
 */
export interface PersistentStore<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  save(): boolean;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

let suspended = false;

/** Stops all stores from writing. Used right before stored preferences are wiped and the page reloads. */
export function suspendPersistence(): void {
  suspended = true;
}

export function createPersistentStore<T>(
  key: string,
  defaults: () => T,
  /** Turns whatever was stored (possibly by an older version) into a valid value. */
  sanitize: (stored: unknown, fallback: T) => T,
): PersistentStore<T> {
  const listeners = new Set<() => void>();
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let state: T | undefined;
  let loaded = false;

  // Loaded on first use, so a different storage adapter can be installed at start-up.
  function current(): T {
    if (!loaded) {
      const fallback = defaults();
      const stored = getPreferenceStorage().read(key);
      try {
        state = stored === undefined ? fallback : sanitize(stored, fallback);
      } catch {
        state = fallback;
      }
      loaded = true;
    }
    return state as T;
  }

  function save(): boolean {
    clearTimeout(writeTimer);
    writeTimer = undefined;
    return !suspended && getPreferenceStorage().write(key, current()) !== false;
  }

  function persist(): void {
    clearTimeout(writeTimer);
    // Debounced: dragging a column edge changes state on every mouse move.
    writeTimer = setTimeout(save, 150);
  }

  // Do not lose the last change when the tab is closed within the debounce window.
  if (globalThis.window !== undefined) {
    globalThis.addEventListener('pagehide', () => {
      if (writeTimer !== undefined) save();
    });
  }

  return {
    get: current,
    save,
    set(next) {
      const before = current();
      const value = typeof next === 'function' ? (next as (value: T) => T)(before) : next;
      if (Object.is(value, before)) return;
      state = value;
      persist();
      listeners.forEach((listener) => listener());
    },
    reset() {
      this.set(defaults());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: PersistentStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for plain JSON-like values (used to detect a modified view). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
