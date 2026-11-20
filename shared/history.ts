export const DAY_MS = 86_400_000;
export const HISTORY_WINDOW_DAYS = 31;
export const HISTORY_PAGE_SIZE = 100;
// Jira requires offset + size to be strictly below 20,000.
export const HISTORY_MAX_OFFSET = 19_800;

export function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseUtcDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && utcDate(timestamp) === value ? timestamp : null;
}

export function historyDateLimits(now: number): { earliest: string; today: string } {
  const date = new Date(now);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0); // Feb 29 -> Feb 28
  return { earliest: utcDate(date.getTime()), today: utcDate(now) };
}

export function previousCalendarMonth(now: number): { from: string; to: string } {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    from: utcDate(Date.UTC(year, month - 1, 1)),
    to: utcDate(Date.UTC(year, month, 0)),
  };
}

/** Split inclusive UTC dates into non-overlapping windows, newest first. */
export function historyWindows(from: number, to: number) {
  const windows: Array<{ from: string; to: string }> = [];
  for (let end = to; end >= from;) {
    const start = Math.max(from, end - (HISTORY_WINDOW_DAYS - 1) * DAY_MS);
    windows.push({ from: utcDate(start), to: utcDate(end) });
    end = start - DAY_MS;
  }
  return windows;
}
