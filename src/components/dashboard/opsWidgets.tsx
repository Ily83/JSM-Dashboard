import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleCheck, HeartPulse, Loader2, Plus, ShieldAlert, TriangleAlert, UserRound, Users, Wrench, X } from 'lucide-react';
import {
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_MAX_DAYS,
  type Maintenance,
  type MaintenanceRule,
  type MaintenanceTarget,
  type OnCallParticipant,
} from '../../../shared/opsContext';
import { useWriteActions } from '../../api/hooks';
import {
  useCancelMaintenance,
  useCreateMaintenance,
  useHeartbeats,
  useMaintenanceFor,
  useMaintenances,
  useMaintenanceTargets,
  useOnCall,
} from '../../api/opsContext';
import { cn } from '../../lib/cn';
import { formatAge } from '../../lib/format';
import { useNow } from '../../lib/now';

/**
 * Widgets for the Jira Operations context: maintenance windows (with a form
 * to start one and a button to end one), heartbeats, and who is on call.
 * They fetch only while shown (see api/opsContext.ts).
 */

const short = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function when(ms: number | null, now: number): string {
  if (!ms) return '–';
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? short.format(ms) : dayShort.format(ms);
}

/** "in 1h 40m" for a future time. */
function inTime(ms: number, now: number): string {
  return `in ${formatAge(now - Math.max(0, ms - now), now)}`;
}

function OpsPanel({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-md border border-line bg-panel">
      <div className="flex flex-none items-center gap-1.5 px-3 pb-1 pt-2">
        <span className="flex-none text-muted">{icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">{children}</div>
    </section>
  );
}

function Quiet({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' }) {
  return (
    <p className={cn('flex items-center gap-1.5 px-1.5 py-1 text-xs', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-subtle')}>{children}</p>
  );
}

function Failed({ error }: { error: Error }) {
  return (
    <p className="flex items-start gap-1.5 px-1.5 py-1 text-xs text-warn" data-tip={error.message} data-tip-always="">
      <TriangleAlert size={12} aria-hidden className="mt-0.5 flex-none" />
      <span className="line-clamp-3">{error.message}</span>
    </p>
  );
}

function rulesLabel(rules: Maintenance['rules']): string {
  if (rules.length === 0) return 'No rules';
  const named = rules.map((r) => `${r.state === 'enabled' ? '+' : ''}${r.name ?? r.entity.type}`);
  return named.length <= 2 ? named.join(', ') : `${named.slice(0, 2).join(', ')} +${named.length - 2}`;
}

// ---- Maintenance windows -----------------------------------------------------------

function MaintenanceRow({ m, canCancel }: { m: Maintenance; canCancel: boolean }) {
  const now = useNow();
  const cancel = useCancelMaintenance();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 5000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const active = m.status === 'active';
  const tip = [
    m.description,
    `${m.teamName ?? 'All teams'} · ${when(m.startDate, now)} – ${when(m.endDate, now)}`,
    ...m.rules.map((r) => `${r.state === 'enabled' ? 'Enable' : 'Disable'} ${r.entity.type} ${r.name ?? r.entity.id}`),
  ].join('\n');

  return (
    <li className="rounded px-1.5 py-1 hover:bg-hover">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 flex-none rounded-full', active ? 'bg-warn' : 'border border-line-strong')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" data-tip={tip} data-tip-always="">
          {m.description || 'Maintenance'}
        </span>
        <span className="flex-none text-[11px] tabular-nums text-muted">
          {active ? (m.endDate ? `ends ${inTime(m.endDate, now)}` : 'active') : m.startDate ? when(m.startDate, now) : 'planned'}
        </span>
        {canCancel &&
          (confirm ? (
            <span className="flex flex-none items-center gap-0.5">
              <button
                type="button"
                autoFocus
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(m, { onSettled: () => setConfirm(false) })}
                className="inline-flex h-5 items-center gap-1 rounded border border-warn px-1.5 text-[11px] font-semibold text-warn hover:bg-warn-soft disabled:opacity-50"
              >
                {cancel.isPending ? <Loader2 size={11} aria-hidden className="spin" /> : <Check size={11} aria-hidden />}
                {active ? 'End now' : 'Cancel'}
              </button>
              <button type="button" aria-label="Keep" onClick={() => setConfirm(false)} className="rounded p-0.5 text-subtle hover:bg-hover hover:text-fg">
                <X size={11} aria-hidden />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label={active ? `End maintenance ${m.description}` : `Cancel maintenance ${m.description}`}
              data-tip={active ? 'End now' : 'Cancel'}
              data-tip-always=""
              className="flex-none rounded p-0.5 text-subtle hover:bg-hover hover:text-fg"
            >
              <X size={12} aria-hidden />
            </button>
          ))}
      </div>
      <div className="ml-4 truncate text-[11px] text-subtle">
        {m.teamName ?? 'All teams'} · {rulesLabel(m.rules)}
      </div>
      {cancel.error && <p className="ml-4 text-[11px] text-crit">{cancel.error.message}</p>}
    </li>
  );
}

export function MaintenanceWidget() {
  const query = useMaintenances();
  const canWrite = useWriteActions().has('maintenance');
  const [creating, setCreating] = useState(false);
  const list = query.data?.maintenances ?? [];
  return (
    <OpsPanel
      title="Maintenance"
      icon={<Wrench size={12} aria-hidden />}
      action={
        canWrite && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-5 flex-none items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-accent hover:bg-hover"
            aria-label="New maintenance"
          >
            <Plus size={12} aria-hidden />
            New
          </button>
        )
      }
    >
      {query.isPending ? (
        <Quiet>
          <Loader2 size={12} aria-hidden className="spin" /> Loading…
        </Quiet>
      ) : query.error && !query.data ? (
        <Failed error={query.error} />
      ) : list.length === 0 ? (
        <Quiet tone="ok">
          <CircleCheck size={12} aria-hidden /> None active or planned
        </Quiet>
      ) : (
        <ul className="grid gap-0.5">
          {list.map((m) => (
            <MaintenanceRow key={`${m.teamId ?? 'global'}:${m.id}`} m={m} canCancel={canWrite} />
          ))}
        </ul>
      )}
      {creating && <NewMaintenanceDialog onClose={() => setCreating(false)} />}
    </OpsPanel>
  );
}

/** Top-bar chip while a maintenance window is active (only when the widget is on). */
export function MaintenanceIndicator() {
  const { data } = useMaintenances();
  const now = useNow();
  const active = (data?.maintenances ?? []).filter((m) => m.status === 'active');
  if (active.length === 0) return null;
  const tip = active.map((m) => `${m.description || 'Maintenance'} · ${m.teamName ?? 'All teams'} · ${m.endDate ? `until ${when(m.endDate, now)}` : 'active'}`).join('\n');
  return (
    <span
      role="status"
      className="flex h-7 flex-none items-center gap-1.5 rounded-md border border-warn/50 bg-warn-soft px-2 text-xs font-semibold text-warn"
      data-tip={tip}
      data-tip-always=""
    >
      <Wrench size={13} aria-hidden />
      <span className="max-md:hidden">Maintenance</span>
      {active.length > 1 && <span className="tabular-nums">{active.length}</span>}
    </span>
  );
}

/** Detail-panel chip when the alert's integration is disabled by an active maintenance. */
export function MaintenanceBadge({ integrationName }: { integrationName: string | null }) {
  const m = useMaintenanceFor(integrationName);
  const now = useNow();
  if (!m) return null;
  return (
    <span
      className="inline-flex h-[18px] flex-none items-center gap-1 rounded border border-warn/50 bg-warn-soft px-1.5 text-[11px] font-semibold text-warn"
      data-tip={`${integrationName} is disabled by "${m.description || 'maintenance'}"${m.endDate ? ` until ${when(m.endDate, now)}` : ''}`}
      data-tip-always=""
    >
      <Wrench size={11} aria-hidden />
      Maintenance
    </span>
  );
}

// ---- New maintenance -----------------------------------------------------------------

const DURATIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h', minutes: 240 },
] as const;

function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TYPE_LABEL: Record<MaintenanceTarget['type'], string> = { integration: 'Integrations', policy: 'Policies', sync: 'Syncs' };
const field = 'h-7 w-full rounded-md border border-line-strong bg-panel px-2 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none';

function NewMaintenanceDialog({ onClose }: { onClose: () => void }) {
  const targetsQuery = useMaintenanceTargets(true);
  const create = useCreateMaintenance();
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [minutes, setMinutes] = useState<number | 'custom'>(60);
  const [startLater, setStartLater] = useState(false);
  const [start, setStart] = useState(() => localInput(Date.now() + 60 * 60_000));
  const [end, setEnd] = useState(() => localInput(Date.now() + 3 * 60 * 60_000));
  const [chosen, setChosen] = useState<Map<string, MaintenanceRule>>(() => new Map());
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  const targets = useMemo(() => {
    const all = targetsQuery.data?.targets ?? [];
    // A team maintenance can only switch off that team's entities.
    return teamId ? all.filter((t) => t.teamId === teamId) : all;
  }, [targetsQuery.data, teamId]);
  const integrations = targets.filter((t) => t.type === 'integration');

  const startMs = startLater ? Date.parse(start) : Date.now();
  const endMs = minutes === 'custom' ? Date.parse(end) : startMs + minutes * 60_000;
  const rules = [...chosen.values()].filter((r) => targets.some((t) => t.id === r.entity.id && t.type === r.entity.type));
  const timeError = !Number.isFinite(startMs) || !Number.isFinite(endMs)
    ? 'Choose a time'
    : endMs <= startMs + 60_000
      ? 'End after start'
      : endMs - startMs > MAINTENANCE_MAX_DAYS * 86_400_000
        ? `At most ${MAINTENANCE_MAX_DAYS} days`
        : startLater && startMs < Date.now()
          ? 'Start in the future'
          : null;
  const ready = description.trim() !== '' && rules.length > 0 && !timeError;

  const toggle = (t: MaintenanceTarget) => {
    setConfirming(false);
    setChosen((current) => {
      const next = new Map(current);
      const key = `${t.type}:${t.id}`;
      if (next.has(key)) next.delete(key);
      else next.set(key, { entity: { id: t.id, type: t.type }, state: 'disabled' });
      return next;
    });
  };
  const setPolicyState = (t: MaintenanceTarget, state: MaintenanceRule['state']) => {
    setChosen((current) => new Map(current).set(`${t.type}:${t.id}`, { entity: { id: t.id, type: t.type }, state }));
  };
  const allIntegrations = integrations.length > 0 && integrations.every((t) => chosen.has(`integration:${t.id}`));

  const submit = () => {
    if (!ready) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    create.mutate(
      {
        description: description.trim(),
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(endMs).toISOString(),
        teamId: teamId || null,
        rules,
      },
      { onSuccess: onClose, onError: () => setConfirming(false) },
    );
  };

  const summary = `${rules.length} rule${rules.length === 1 ? '' : 's'} · ${teamId ? (targetsQuery.data?.teams.find((t) => t.id === teamId)?.name ?? 'team') : 'all teams'} · ${startLater ? dayShort.format(startMs) : 'now'} → ${Number.isFinite(endMs) ? dayShort.format(endMs) : '–'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="New maintenance"
        className="flex max-h-[85vh] w-[440px] max-w-full flex-col rounded-lg border border-line-strong bg-panel shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
          <Wrench size={14} aria-hidden className="text-muted" />
          <h2 className="flex-1 text-sm font-semibold">New maintenance</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={14} aria-hidden />
          </button>
        </div>
        <form
          className="grid min-h-0 gap-3 overflow-y-auto px-4 py-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setConfirming(false);
            }}
            maxLength={MAINTENANCE_DESCRIPTION_MAX}
            placeholder="Description"
            aria-label="Description"
            className={field}
          />
          <label className="grid gap-1">
            <span className="text-muted">Scope</span>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setConfirming(false);
              }}
              className={field}
            >
              <option value="">All teams</option>
              {(targetsQuery.data?.teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1">
            <span className="text-muted">Duration</span>
            <div className="flex flex-wrap gap-1">
              {DURATIONS.map((d) => (
                <button
                  key={d.minutes}
                  type="button"
                  aria-pressed={minutes === d.minutes}
                  onClick={() => {
                    setMinutes(d.minutes);
                    setConfirming(false);
                  }}
                  className={cn('h-7 rounded-md border px-2.5 font-medium', minutes === d.minutes ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong hover:bg-hover')}
                >
                  {d.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={minutes === 'custom'}
                onClick={() => setMinutes('custom')}
                className={cn('h-7 rounded-md border px-2.5 font-medium', minutes === 'custom' ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong hover:bg-hover')}
              >
                Until…
              </button>
            </div>
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={startLater} onChange={(e) => setStartLater(e.target.checked)} />
              Start later
            </label>
            {(startLater || minutes === 'custom') && (
              <div className="grid grid-cols-2 gap-1.5">
                {startLater && (
                  <input type="datetime-local" aria-label="Start" value={start} min={localInput(Date.now())} onChange={(e) => setStart(e.target.value)} className={field} />
                )}
                {minutes === 'custom' && (
                  <input type="datetime-local" aria-label="End" value={end} min={localInput(Date.now())} onChange={(e) => setEnd(e.target.value)} className={cn(field, !startLater && 'col-span-2')} />
                )}
              </div>
            )}
            {timeError && <span className="text-warn">{timeError}</span>}
          </div>
          <div className="grid gap-1">
            <span className="flex items-center justify-between text-muted">
              Switch off
              {integrations.length > 1 && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={allIntegrations}
                    onChange={() => {
                      setConfirming(false);
                      setChosen((current) => {
                        const next = new Map(current);
                        for (const t of integrations) {
                          const key = `integration:${t.id}`;
                          if (allIntegrations) next.delete(key);
                          else next.set(key, { entity: { id: t.id, type: 'integration' }, state: 'disabled' });
                        }
                        return next;
                      });
                    }}
                  />
                  All integrations
                </label>
              )}
            </span>
            {targetsQuery.isPending ? (
              <Quiet>
                <Loader2 size={12} aria-hidden className="spin" /> Loading…
              </Quiet>
            ) : targetsQuery.error ? (
              <Failed error={targetsQuery.error} />
            ) : targets.length === 0 ? (
              <Quiet tone="warn">Nothing to switch off{teamId ? ' for this team' : ''}</Quiet>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-line">
                {(['integration', 'policy', 'sync'] as const).map((type) => {
                  const items = targets.filter((t) => t.type === type);
                  if (items.length === 0) return null;
                  return (
                    <fieldset key={type} className="border-b border-line px-2 py-1 last:border-b-0">
                      <legend className="sr-only">{TYPE_LABEL[type]}</legend>
                      <p className="py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle" aria-hidden>
                        {TYPE_LABEL[type]}
                      </p>
                      {items.map((t) => {
                        const rule = chosen.get(`${t.type}:${t.id}`);
                        return (
                          <div key={t.id} className="flex items-center gap-2 py-0.5">
                            <label className="flex min-w-0 flex-1 items-center gap-2">
                              <input type="checkbox" checked={Boolean(rule)} onChange={() => toggle(t)} />
                              <span className={cn('truncate', t.enabled === false && 'text-subtle')}>{t.name}</span>
                            </label>
                            {rule && t.type === 'policy' && (
                              <select
                                aria-label={`State of ${t.name}`}
                                value={rule.state}
                                onChange={(e) => setPolicyState(t, e.target.value as MaintenanceRule['state'])}
                                className="h-6 rounded border border-line-strong bg-panel px-1 text-[11px]"
                              >
                                <option value="disabled">Disable</option>
                                <option value="enabled">Enable</option>
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </fieldset>
                  );
                })}
              </div>
            )}
          </div>
          {create.error && (
            <p role="alert" className="flex items-start gap-1.5 text-crit">
              <ShieldAlert size={13} aria-hidden className="mt-0.5 flex-none" />
              {create.error.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            {confirming && <span className="mr-auto min-w-0 truncate text-muted">{summary}</span>}
            <button type="button" onClick={onClose} className="h-7 rounded-md border border-line-strong px-3 font-semibold hover:bg-hover">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready || create.isPending}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-3 font-semibold disabled:opacity-50', confirming ? 'bg-warn text-panel' : 'bg-accent text-on-accent')}
            >
              {create.isPending && <Loader2 size={12} aria-hidden className="spin" />}
              {confirming ? 'Confirm' : startLater ? 'Plan maintenance' : 'Start maintenance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Heartbeats ----------------------------------------------------------------

export function HeartbeatsWidget() {
  const query = useHeartbeats();
  const beats = query.data?.heartbeats ?? [];
  const failing = beats.filter((h) => h.enabled && h.status === 'Unresponsive');
  const ok = beats.filter((h) => h.enabled && h.status === 'Responsive').length;
  const off = beats.filter((h) => !h.enabled || h.status === 'Off').length;
  return (
    <OpsPanel title="Heartbeats" icon={<HeartPulse size={12} aria-hidden />} action={beats.length > 0 && <span className="text-[11px] tabular-nums text-subtle">{ok} ok{off ? ` · ${off} off` : ''}</span>}>
      {query.isPending ? (
        <Quiet>
          <Loader2 size={12} aria-hidden className="spin" /> Loading…
        </Quiet>
      ) : query.error && !query.data ? (
        <Failed error={query.error} />
      ) : beats.length === 0 ? (
        <Quiet>No heartbeats</Quiet>
      ) : failing.length === 0 ? (
        <Quiet tone="ok">
          <CircleCheck size={12} aria-hidden /> All reporting
        </Quiet>
      ) : (
        <ul className="grid gap-0.5">
          {failing.map((h) => (
            <li key={`${h.teamId}:${h.name}`} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs" data-tip={h.description ?? h.name} data-tip-always="">
              <TriangleAlert size={12} aria-hidden className="flex-none text-crit" />
              <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              <span className="flex-none truncate text-[11px] text-subtle">{h.teamName ?? ''}</span>
              {h.interval && h.intervalUnit && (
                <span className="flex-none text-[11px] tabular-nums text-muted">
                  every {h.interval} {h.intervalUnit.toLowerCase().replace(/s$/, h.interval === 1 ? '' : 's')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {query.data && query.data.failedTeams > 0 && <Quiet tone="warn">{query.data.failedTeams} team(s) not readable</Quiet>}
    </OpsPanel>
  );
}

// ---- On call ---------------------------------------------------------------------

function Participant({ p }: { p: OnCallParticipant }) {
  const group = p.type !== 'user';
  const label = p.name ?? `${group ? p.type : 'User'} ${p.id.slice(0, 8)}`;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded border border-line px-1.5 text-[11px] leading-[18px]"
      data-tip={p.name ? `${p.type}: ${p.name}` : `${p.type} ${p.id}`}
      data-tip-always=""
    >
      {group ? <Users size={11} aria-hidden className="flex-none text-subtle" /> : <UserRound size={11} aria-hidden className="flex-none text-subtle" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function OnCallWidget() {
  const query = useOnCall();
  const schedules = query.data?.schedules ?? [];
  return (
    <OpsPanel title="On call now" icon={<UserRound size={12} aria-hidden />}>
      {query.isPending ? (
        <Quiet>
          <Loader2 size={12} aria-hidden className="spin" /> Loading…
        </Quiet>
      ) : query.error && !query.data ? (
        <Failed error={query.error} />
      ) : schedules.length === 0 ? (
        <Quiet>No schedules</Quiet>
      ) : (
        <ul className="grid gap-1">
          {schedules.map((s) => (
            <li key={s.id} className="rounded px-1.5 py-0.5">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                {s.teamName && <span className="flex-none truncate text-[11px] text-subtle">{s.teamName}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {s.error ? (
                  <span className="text-[11px] text-warn">Not readable</span>
                ) : s.onCall.length === 0 ? (
                  <span className="text-[11px] text-subtle">Nobody</span>
                ) : (
                  s.onCall.map((p) => <Participant key={`${p.type}:${p.id}`} p={p} />)
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </OpsPanel>
  );
}
