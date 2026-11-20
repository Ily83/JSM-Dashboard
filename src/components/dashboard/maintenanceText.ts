import { MAINTENANCE_MAX_DAYS, type Maintenance } from '../../../shared/opsContext';
import { formatAge } from '../../lib/format';

/**
 * Text shown by the maintenance widgets: times, a window's timing and rules,
 * and for a new window the check of its times and the confirmation summary.
 */

const short = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function when(ms: number | null, now: number): string {
  if (!ms) return '–';
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? short.format(ms) : dayShort.format(ms);
}

/** "in 1h 40m" for a future time. */
export function inTime(ms: number, now: number): string {
  return `in ${formatAge(now - Math.max(0, ms - now), now)}`;
}

/** When a window ends (active) or starts (otherwise). */
export function maintenanceTiming(m: Pick<Maintenance, 'status' | 'startDate' | 'endDate'>, now: number): string {
  if (m.status === 'active') return m.endDate ? `ends ${inTime(m.endDate, now)}` : 'active';
  return m.startDate ? when(m.startDate, now) : 'planned';
}

export function rulesLabel(rules: Maintenance['rules']): string {
  if (rules.length === 0) return 'No rules';
  const named = rules.map((r) => `${r.state === 'enabled' ? '+' : ''}${r.name ?? r.entity.type}`);
  return named.length <= 2 ? named.join(', ') : `${named.slice(0, 2).join(', ')} +${named.length - 2}`;
}

/** Why the times of a new window cannot be used, or null when they can. */
export function maintenanceTimeError(startMs: number, endMs: number, startLater: boolean, now: number): string | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'Choose a time';
  if (endMs <= startMs + 60_000) return 'End after start';
  if (endMs - startMs > MAINTENANCE_MAX_DAYS * 86_400_000) return `At most ${MAINTENANCE_MAX_DAYS} days`;
  if (startLater && startMs < now) return 'Start in the future';
  return null;
}

/** The scope of a new window: the chosen team's name, or all teams. */
export function scopeLabel(teamId: string, teams: ReadonlyArray<{ id: string; name: string }> | undefined): string {
  if (!teamId) return 'all teams';
  return teams?.find((t) => t.id === teamId)?.name ?? 'team';
}

/** "2 rules · all teams · now → Fri 21 Nov, 14:00", shown while confirming. `startMs` is null for "now". */
/** A date for the summary, or a dash while the field is empty (formatting NaN throws). */
function shortOrDash(ms: number): string {
  return Number.isFinite(ms) ? dayShort.format(ms) : '–';
}

export function maintenanceSummary(ruleCount: number, scope: string, startMs: number | null, endMs: number): string {
  const plural = ruleCount === 1 ? '' : 's';
  const from = startMs === null ? 'now' : shortOrDash(startMs);
  const to = shortOrDash(endMs);
  return `${ruleCount} rule${plural} · ${scope} · ${from} → ${to}`;
}

export function submitLabel(confirming: boolean, startLater: boolean): string {
  if (confirming) return 'Confirm';
  return startLater ? 'Plan maintenance' : 'Start maintenance';
}
