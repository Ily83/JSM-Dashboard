import { useSyncExternalStore } from 'react';

/**
 * A shared clock for relative timestamps ("12m ago"). One timer for the whole
 * page, running only while something is subscribed and the tab is visible.
 */
const TICK_MS = 15_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (timer === undefined && !document.hidden) timer = setInterval(tick, TICK_MS);
}

function stop(): void {
  clearInterval(timer);
  timer = undefined;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (listeners.size > 0) {
    tick();
    start();
  }
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
