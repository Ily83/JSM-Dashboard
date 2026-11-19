import type { Alert } from '../../shared/types';
import { getPreferenceStorage } from './storage';

/**
 * Detects P1 alerts that need attention now, for the sound and desktop
 * notification. Only P1, nothing else.
 *
 * Watched: P1 alerts that are open or acknowledged (not snoozed, not
 * closed). An alert "arrives" when it enters that set: a new P1 alert, an
 * alert raised to P1, or a P1 alert whose snooze ended.
 */

export function watchedP1(alerts: readonly Alert[]): Set<string> {
  const ids = new Set<string>();
  for (const alert of alerts) {
    if (alert.priority === 'P1' && (alert.status === 'open' || alert.status === 'acked')) ids.add(alert.id);
  }
  return ids;
}

/**
 * Compares a new list with the previous watched set. With no previous set
 * (first load, or notifications just turned on) nothing counts as arriving.
 */
export function arrivingP1(previous: ReadonlySet<string> | null, alerts: readonly Alert[]): { watched: Set<string>; arrived: Alert[] } {
  const watched = watchedP1(alerts);
  if (previous === null) return { watched, arrived: [] };
  const arrived = alerts.filter((a) => watched.has(a.id) && !previous.has(a.id));
  arrived.sort((a, b) => b.createdAt - a.createdAt);
  return { watched, arrived };
}

// ---- One alarm per alert, even with several tabs open ------------------------

const CLAIM_KEY = 'p1-notified:v1';
const CLAIM_TTL_MS = 24 * 3_600_000;

/**
 * Returns the alerts this tab should announce: those no other tab has
 * announced in the last 24 hours. Without storage, every tab announces.
 */
export function claimAlarms(alerts: readonly Alert[], now = Date.now()): Alert[] {
  if (alerts.length === 0) return [];
  const storage = getPreferenceStorage();
  let claimed: Record<string, number> = {};
  try {
    const stored = storage.read(CLAIM_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) claimed = stored as Record<string, number>;
  } catch {
    return [...alerts];
  }
  const fresh: Record<string, number> = {};
  for (const [id, at] of Object.entries(claimed)) if (typeof at === 'number' && now - at < CLAIM_TTL_MS) fresh[id] = at;
  const mine = alerts.filter((a) => fresh[a.id] === undefined);
  for (const alert of mine) fresh[alert.id] = now;
  try {
    storage.write(CLAIM_KEY, fresh);
  } catch {
    // Storage full or blocked: announce anyway.
  }
  return mine;
}

/** Forgets that an alert was announced, so it alarms again if it comes back. */
export function releaseAlarms(ids: Iterable<string>): void {
  const storage = getPreferenceStorage();
  try {
    const stored = storage.read(CLAIM_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
    const next = { ...(stored as Record<string, number>) };
    let changed = false;
    for (const id of ids) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) storage.write(CLAIM_KEY, next);
  } catch {
    // Nothing to do.
  }
}
