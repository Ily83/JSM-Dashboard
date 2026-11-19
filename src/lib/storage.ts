/**
 * Where preferences are kept.
 *
 * Today: the browser's localStorage. Every store goes through this interface
 * and nothing else touches localStorage, so moving to per-user storage on a
 * server later means writing one more adapter (hydrate() loads the user's
 * preferences before the first render, write() sends changes) and passing it
 * to setPreferenceStorage(). No component or store needs to change.
 */
export interface PreferenceStorage {
  /** Optional asynchronous preload, awaited once before the application renders. */
  hydrate?(): Promise<void>;
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

const NAMESPACE = 'jsm-alert-center:';

export const localStorageAdapter: PreferenceStorage = {
  read(key) {
    try {
      const raw = localStorage.getItem(NAMESPACE + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined; // storage blocked or corrupted: fall back to defaults
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the preference is simply not remembered.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(NAMESPACE + key);
    } catch {
      // ignore
    }
  },
};

let storage: PreferenceStorage = localStorageAdapter;

export function getPreferenceStorage(): PreferenceStorage {
  return storage;
}

/** Must be called before any store is first read. */
export function setPreferenceStorage(next: PreferenceStorage): void {
  storage = next;
}
