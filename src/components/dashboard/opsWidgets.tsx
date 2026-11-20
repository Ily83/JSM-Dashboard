import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleCheck, HeartPulse, Loader2, Plus, ShieldAlert, TriangleAlert, UserRound, Users, Wrench, X } from 'lucide-react';
import {
  MAINTENANCE_DESCRIPTION_MAX,
  type Heartbeat,
  type Maintenance,
  type MaintenanceRule,
  type MaintenanceTarget,
  type OnCallParticipant,
  type OnCallSchedule,
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
import { useNow } from '../../lib/now';
import { maintenanceSummary, maintenanceTimeError, maintenanceTiming, rulesLabel, scopeLabel, submitLabel, when } from './maintenanceText';

/**
 * Widgets for the Jira Operations context: maintenance windows (with a form
 * to start one and a button to end one), heartbeats, and who is on call.
 * They fetch only while shown (see api/opsContext.ts).
 */

function OpsPanel({ title, icon, action, children }: Readonly<{ title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }>) {
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

const QUIET_TONE = { muted: 'text-subtle', ok: 'text-ok', warn: 'text-warn' } as const;

function Quiet({ children, tone = 'muted' }: Readonly<{ children: ReactNode; tone?: keyof typeof QUIET_TONE }>) {
  return <p className={cn('flex items-center gap-1.5 px-1.5 py-1 text-xs', QUIET_TONE[tone])}>{children}</p>;
}

function Loading() {
  return (
    <Quiet>
      <Loader2 size={12} aria-hidden className="spin" /> Loading…
    </Quiet>
  );
}

function Failed({ error }: Readonly<{ error: Error }>) {
  return (
    <p className="flex items-start gap-1.5 px-1.5 py-1 text-xs text-warn" data-tip={error.message} data-tip-always="">
      <TriangleAlert size={12} aria-hidden className="mt-0.5 flex-none" />
      <span className="line-clamp-3">{error.message}</span>
    </p>
  );
}

// ---- Maintenance windows -----------------------------------------------------------

function MaintenanceRow({ m, canCancel }: Readonly<{ m: Maintenance; canCancel: boolean }>) {
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
        <span className="flex-none text-[11px] tabular-nums text-muted">{maintenanceTiming(m, now)}</span>
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

function MaintenanceList({ query, canCancel }: Readonly<{ query: ReturnType<typeof useMaintenances>; canCancel: boolean }>) {
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <Failed error={query.error} />;
  const list = query.data?.maintenances ?? [];
  if (list.length === 0) {
    return (
      <Quiet tone="ok">
        <CircleCheck size={12} aria-hidden /> None active or planned
      </Quiet>
    );
  }
  return (
    <ul className="grid gap-0.5">
      {list.map((m) => (
        <MaintenanceRow key={`${m.teamId ?? 'global'}:${m.id}`} m={m} canCancel={canCancel} />
      ))}
    </ul>
  );
}

export function MaintenanceWidget() {
  const query = useMaintenances();
  const canWrite = useWriteActions().has('maintenance');
  const [creating, setCreating] = useState(false);
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
      <MaintenanceList query={query} canCancel={canWrite} />
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
  const tip = active
    .map((m) => {
      const until = m.endDate ? `until ${when(m.endDate, now)}` : 'active';
      return `${m.description || 'Maintenance'} · ${m.teamName ?? 'All teams'} · ${until}`;
    })
    .join('\n');
  return (
    <output
      className="flex h-7 flex-none items-center gap-1.5 rounded-md border border-warn/50 bg-warn-soft px-2 text-xs font-semibold text-warn"
      data-tip={tip}
      data-tip-always=""
    >
      <Wrench size={13} aria-hidden />
      <span className="max-md:hidden">Maintenance</span>
      {active.length > 1 && <span className="tabular-nums">{active.length}</span>}
    </output>
  );
}

/** Detail-panel chip when the alert's integration is disabled by an active maintenance. */
export function MaintenanceBadge({ integrationName }: Readonly<{ integrationName: string | null }>) {
  const m = useMaintenanceFor(integrationName);
  const now = useNow();
  if (!m) return null;
  const until = m.endDate ? ` until ${when(m.endDate, now)}` : '';
  return (
    <span
      className="inline-flex h-[18px] flex-none items-center gap-1 rounded border border-warn/50 bg-warn-soft px-1.5 text-[11px] font-semibold text-warn"
      data-tip={`${integrationName} is disabled by "${m.description || 'maintenance'}"${until}`}
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

function DurationFields({
  minutes,
  onPreset,
  onCustom,
  startLater,
  onStartLater,
  start,
  onStart,
  end,
  onEnd,
  timeError,
}: Readonly<{
  minutes: number | 'custom';
  onPreset: (minutes: number) => void;
  onCustom: () => void;
  startLater: boolean;
  onStartLater: (startLater: boolean) => void;
  start: string;
  onStart: (start: string) => void;
  end: string;
  onEnd: (end: string) => void;
  timeError: string | null;
}>) {
  return (
    <div className="grid gap-1">
      <span className="text-muted">Duration</span>
      <div className="flex flex-wrap gap-1">
        {DURATIONS.map((d) => (
          <button
            key={d.minutes}
            type="button"
            aria-pressed={minutes === d.minutes}
            onClick={() => onPreset(d.minutes)}
            className={cn('h-7 rounded-md border px-2.5 font-medium', minutes === d.minutes ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong hover:bg-hover')}
          >
            {d.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={minutes === 'custom'}
          onClick={onCustom}
          className={cn('h-7 rounded-md border px-2.5 font-medium', minutes === 'custom' ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong hover:bg-hover')}
        >
          Until…
        </button>
      </div>
      <label className="mt-1 flex items-center gap-2">
        <input type="checkbox" checked={startLater} onChange={(e) => onStartLater(e.target.checked)} />Start later
      </label>
      {(startLater || minutes === 'custom') && (
        <div className="grid grid-cols-2 gap-1.5">
          {startLater && (
            <input type="datetime-local" aria-label="Start" value={start} min={localInput(Date.now())} onChange={(e) => onStart(e.target.value)} className={field} />
          )}
          {minutes === 'custom' && (
            <input type="datetime-local" aria-label="End" value={end} min={localInput(Date.now())} onChange={(e) => onEnd(e.target.value)} className={cn(field, !startLater && 'col-span-2')} />
          )}
        </div>
      )}
      {timeError && <span className="text-warn">{timeError}</span>}
    </div>
  );
}

/** What a new window can switch off, by type, with the state for policies. */
function TargetList({
  pending,
  error,
  targets,
  forTeam,
  chosen,
  onToggle,
  onPolicyState,
}: Readonly<{
  pending: boolean;
  error: Error | null;
  targets: MaintenanceTarget[];
  forTeam: boolean;
  chosen: ReadonlyMap<string, MaintenanceRule>;
  onToggle: (target: MaintenanceTarget) => void;
  onPolicyState: (target: MaintenanceTarget, state: MaintenanceRule['state']) => void;
}>) {
  if (pending) return <Loading />;
  if (error) return <Failed error={error} />;
  if (targets.length === 0) return <Quiet tone="warn">Nothing to switch off{forTeam ? ' for this team' : ''}</Quiet>;
  return (
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
                    <input type="checkbox" checked={Boolean(rule)} onChange={() => onToggle(t)} />
                    <span className={cn('truncate', t.enabled === false && 'text-subtle')}>{t.name}</span>
                  </label>
                  {rule && t.type === 'policy' && (
                    <select
                      aria-label={`State of ${t.name}`}
                      value={rule.state}
                      onChange={(e) => onPolicyState(t, e.target.value as MaintenanceRule['state'])}
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
  );
}

function NewMaintenanceDialog({ onClose }: Readonly<{ onClose: () => void }>) {
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
  const timeError = maintenanceTimeError(startMs, endMs, startLater, Date.now());
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
  const toggleAllIntegrations = () => {
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
  };

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

  const summary = maintenanceSummary(rules.length, scopeLabel(teamId, targetsQuery.data?.teams), startLater ? startMs : null, endMs);

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
          <DurationFields
            minutes={minutes}
            onPreset={(preset) => {
              setMinutes(preset);
              setConfirming(false);
            }}
            onCustom={() => setMinutes('custom')}
            startLater={startLater}
            onStartLater={setStartLater}
            start={start}
            onStart={setStart}
            end={end}
            onEnd={setEnd}
            timeError={timeError}
          />
          <div className="grid gap-1">
            <span className="flex items-center justify-between text-muted">
              Switch off
              {integrations.length > 1 && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={allIntegrations} onChange={toggleAllIntegrations} />All integrations
                </label>
              )}
            </span>
            <TargetList
              pending={targetsQuery.isPending}
              error={targetsQuery.error}
              targets={targets}
              forTeam={Boolean(teamId)}
              chosen={chosen}
              onToggle={toggle}
              onPolicyState={setPolicyState}
            />
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
              {submitLabel(confirming, startLater)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Heartbeats ----------------------------------------------------------------

function HeartbeatList({ query, beats, failing }: Readonly<{ query: ReturnType<typeof useHeartbeats>; beats: Heartbeat[]; failing: Heartbeat[] }>) {
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <Failed error={query.error} />;
  if (beats.length === 0) return <Quiet>No heartbeats</Quiet>;
  if (failing.length === 0) {
    return (
      <Quiet tone="ok">
        <CircleCheck size={12} aria-hidden /> All reporting
      </Quiet>
    );
  }
  return (
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
  );
}

export function HeartbeatsWidget() {
  const query = useHeartbeats();
  const beats = query.data?.heartbeats ?? [];
  const failing = beats.filter((h) => h.enabled && h.status === 'Unresponsive');
  const ok = beats.filter((h) => h.enabled && h.status === 'Responsive').length;
  const off = beats.filter((h) => !h.enabled || h.status === 'Off').length;
  return (
    <OpsPanel title="Heartbeats" icon={<HeartPulse size={12} aria-hidden />} action={beats.length > 0 && <span className="text-[11px] tabular-nums text-subtle">{ok} ok{off ? ` · ${off} off` : ''}</span>}>
      <HeartbeatList query={query} beats={beats} failing={failing} />
      {query.data && query.data.failedTeams > 0 && <Quiet tone="warn">{query.data.failedTeams} team(s) not readable</Quiet>}
    </OpsPanel>
  );
}

// ---- On call ---------------------------------------------------------------------

function Participant({ p }: Readonly<{ p: OnCallParticipant }>) {
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

/** Who is on call now for one schedule. */
function OnCallPeople({ schedule }: Readonly<{ schedule: OnCallSchedule }>) {
  if (schedule.error) return <span className="text-[11px] text-warn">Not readable</span>;
  if (schedule.onCall.length === 0) return <span className="text-[11px] text-subtle">Nobody</span>;
  return (
    <>
      {schedule.onCall.map((p) => (
        <Participant key={`${p.type}:${p.id}`} p={p} />
      ))}
    </>
  );
}

function ScheduleList({ query }: Readonly<{ query: ReturnType<typeof useOnCall> }>) {
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <Failed error={query.error} />;
  const schedules = query.data?.schedules ?? [];
  if (schedules.length === 0) return <Quiet>No schedules</Quiet>;
  return (
    <ul className="grid gap-1">
      {schedules.map((s) => (
        <li key={s.id} className="rounded px-1.5 py-0.5">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
            {s.teamName && <span className="flex-none truncate text-[11px] text-subtle">{s.teamName}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <OnCallPeople schedule={s} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OnCallWidget() {
  const query = useOnCall();
  return (
    <OpsPanel title="On call now" icon={<UserRound size={12} aria-hidden />}>
      <ScheduleList query={query} />
    </OpsPanel>
  );
}
