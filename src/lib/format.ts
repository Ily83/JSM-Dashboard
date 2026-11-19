const absolute = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function formatAbsolute(ms: number | null | undefined): string {
  return ms ? absolute.format(ms) : '–';
}

export function formatClock(ms: number | null | undefined): string {
  return ms ? clock.format(ms) : '–';
}

/** Compact age: "now", "45s", "12m", "3h 05m", "2d 4h", "3w". */
export function formatAge(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ${hours % 24}h`;
  return `${Math.floor(days / 7)}w`;
}

export function formatRelative(ms: number, now: number): string {
  const age = formatAge(ms, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
