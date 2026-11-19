import type { Alert } from '../../shared/types';

/**
 * Hourly activity of a set of alerts over the last 24 hours (karma-style
 * strip). Per clock hour it counts:
 *
 *   created    alert records created in that hour (createdAt)
 *   recurred   alerts whose last occurrence fell in that hour
 *              (lastOccurredAt, when later than the creation)
 *
 * Jira keeps only the last occurrence time per alert, so earlier repeats
 * of a de-duplicated alert are not visible here; its total is in `count`.
 */

export const HOUR_MS = 3_600_000;

export interface HourlyActivity {
  /** Start of the first hour, epoch ms. */
  start: number;
  hours: number;
  created: number[];
  recurred: number[];
  /** Highest created + recurred in one hour. */
  max: number;
}

/** `end` is rounded up to the next full hour, so blocks are clock hours. */
export function hourlyActivity(alerts: readonly Alert[], end: number, hours = 24): HourlyActivity {
  const last = Math.ceil(end / HOUR_MS) * HOUR_MS;
  const start = last - hours * HOUR_MS;
  const created = new Array<number>(hours).fill(0);
  const recurred = new Array<number>(hours).fill(0);
  const bucket = (time: number) => Math.floor((time - start) / HOUR_MS);
  for (const alert of alerts) {
    const c = bucket(alert.createdAt);
    if (alert.createdAt > 0 && c >= 0 && c < hours) created[c]! += 1;
    const occurred = alert.lastOccurredAt;
    if (occurred !== null && occurred - alert.createdAt > 60_000) {
      const r = bucket(occurred);
      if (r >= 0 && r < hours) recurred[r]! += 1;
    }
  }
  let max = 0;
  for (let i = 0; i < hours; i += 1) max = Math.max(max, created[i]! + recurred[i]!);
  return { start, hours, created, recurred, max };
}

/** 0 for an empty hour, then 1–4 by share of the busiest hour. */
export function activityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}
