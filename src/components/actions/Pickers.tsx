import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import { SNOOZE_MAX_DAYS, type DirectoryEntry, type ResponderTarget } from '../../../shared/actions';
import { PRIORITIES, type Alert, type Priority } from '../../../shared/types';
import { useEscalations, useMe, useSchedules, useTeams, useUserSearch } from '../../api/hooks';
import { cn } from '../../lib/cn';
import { PriorityBadge } from '../ui/badges';

/**
 * Pop-over content for the actions that need a choice: who to assign, which
 * responder to add, which escalation, how long to snooze, which priority.
 * Each picker calls `onPick` once and the caller closes the pop-over.
 */

const input = 'h-7 w-full rounded-md border border-line-strong bg-panel px-2 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none';
const option = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-hover disabled:opacity-50';

function Status({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="px-2 py-1.5 text-xs text-subtle">{children}</p>;
}

function OptionList({
  items,
  loading,
  error,
  empty,
  onPick,
}: Readonly<{
  items: DirectoryEntry[] | undefined;
  loading: boolean;
  error: Error | null;
  empty: string;
  onPick: (item: DirectoryEntry) => void;
}>) {
  if (loading) {
    return (
      <Status>
        <Loader2 size={12} aria-hidden className="spin mr-1 inline" />
        Loading…
      </Status>
    );
  }
  if (error) return <p className="px-2 py-1.5 text-xs text-crit">{error.message}</p>;
  if (!items || items.length === 0) return <Status>{empty}</Status>;
  return (
    <ul className="max-h-56 overflow-y-auto">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className={option} onClick={() => onPick(item)}>
            <span className="truncate">{item.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function filterByName(items: DirectoryEntry[] | undefined, text: string): DirectoryEntry[] | undefined {
  const needle = text.trim().toLowerCase();
  return needle ? items?.filter((i) => i.name.toLowerCase().includes(needle)) : items;
}

function SearchBox({ value, onChange, placeholder }: Readonly<{ value: string; onChange: (value: string) => void; placeholder: string }>) {
  return (
    <div className="relative">
      <Search size={12} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cn(input, 'pl-6')} />
    </div>
  );
}

// ---- People -------------------------------------------------------------------

function UserSearch({ onPick, showMe }: Readonly<{ onPick: (user: { accountId: string; displayName: string }) => void; showMe: boolean }>) {
  const [text, setText] = useState('');
  const query = useDeferredValue(text);
  const users = useUserSearch(query);
  const me = useMe(showMe);
  return (
    <div className="grid gap-1.5">
      {showMe && (
        <button type="button" className={cn(option, 'font-semibold text-accent')} disabled={!me.data} onClick={() => me.data && onPick(me.data)}>
          Assign to me{me.data ? ` (${me.data.displayName})` : ''}
        </button>
      )}
      <SearchBox value={text} onChange={setText} placeholder="Search people" />
      {query.trim().length >= 2 && (
        <OptionList
          items={users.data?.map((u) => ({ id: u.accountId, name: u.displayName }))}
          loading={users.isFetching && !users.data}
          error={users.error}
          empty="No match"
          onPick={(item) => onPick({ accountId: item.id, displayName: item.name })}
        />
      )}
    </div>
  );
}

export function AssignPicker({ onPick }: Readonly<{ onPick: (accountId: string, displayName: string) => void }>) {
  return (
    <div className="w-64 p-2">
      <UserSearch showMe onPick={(user) => onPick(user.accountId, user.displayName)} />
    </div>
  );
}

// ---- Responders -----------------------------------------------------------------

const RESPONDER_TABS = [
  { id: 'team', label: 'Team' },
  { id: 'user', label: 'User' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'escalation', label: 'Escalation' },
] as const;

function teamIdsOf(alert: Alert): string[] {
  return alert.responders.filter((r) => r.type === 'team').map((r) => r.id);
}

function TeamList({ onPick }: Readonly<{ onPick: (team: DirectoryEntry) => void }>) {
  const [text, setText] = useState('');
  const teams = useTeams();
  return (
    <div className="grid gap-1.5">
      <SearchBox value={text} onChange={setText} placeholder="Filter teams" />
      <OptionList items={filterByName(teams.data, text)} loading={teams.isPending} error={teams.error} empty="No teams" onPick={onPick} />
    </div>
  );
}

function ScheduleList({ onPick }: Readonly<{ onPick: (schedule: DirectoryEntry) => void }>) {
  const [text, setText] = useState('');
  const schedules = useSchedules();
  return (
    <div className="grid gap-1.5">
      <SearchBox value={text} onChange={setText} placeholder="Filter schedules" />
      <OptionList items={filterByName(schedules.data, text)} loading={schedules.isPending} error={schedules.error} empty="No schedules" onPick={onPick} />
    </div>
  );
}

/** Escalations of the alert's teams and the ones already on the alert, or of another chosen team. */
function EscalationList({ alert, onPick }: Readonly<{ alert: Alert; onPick: (escalation: DirectoryEntry) => void }>) {
  const alertTeams = useMemo(() => teamIdsOf(alert), [alert]);
  const onAlert = useMemo(
    () => alert.responders.filter((r) => r.type === 'escalation').map((r) => ({ id: r.id, name: r.name ?? `Escalation ${r.id.slice(0, 8)}` })),
    [alert],
  );
  const [otherTeam, setOtherTeam] = useState<DirectoryEntry | null>(null);
  const [choosingTeam, setChoosingTeam] = useState(alertTeams.length === 0 && onAlert.length === 0);
  const teamIds = otherTeam ? [otherTeam.id] : alertTeams;
  const escalations = useEscalations(teamIds, !choosingTeam);
  const items = useMemo(() => {
    const byId = new Map([...(otherTeam ? [] : onAlert), ...(escalations.data ?? [])].map((e) => [e.id, e]));
    return [...byId.values()];
  }, [escalations.data, onAlert, otherTeam]);

  if (choosingTeam) {
    return (
      <TeamList
        onPick={(team) => {
          setOtherTeam(team);
          setChoosingTeam(false);
        }}
      />
    );
  }
  return (
    <div className="grid gap-1">
      {otherTeam && <Status>{otherTeam.name}</Status>}
      <OptionList
        items={items}
        loading={escalations.isFetching && items.length === 0}
        error={escalations.error}
        empty="No escalations"
        onPick={onPick}
      />
      <button type="button" className={cn(option, 'text-muted')} onClick={() => setChoosingTeam(true)}>
        Other team…
      </button>
    </div>
  );
}

export function ResponderPicker({ alert, onPick }: Readonly<{ alert: Alert; onPick: (responder: ResponderTarget, name: string) => void }>) {
  const [tab, setTab] = useState<ResponderTarget['type']>('team');
  return (
    <div className="w-72 p-2">
      <div role="tablist" aria-label="Responder type" className="mb-2 flex gap-0.5 rounded-md bg-raised p-0.5">
        {RESPONDER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded px-1.5 py-1 text-[11px] font-medium', tab === t.id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'team' && <TeamList onPick={(t) => onPick({ type: 'team', id: t.id }, t.name)} />}
      {tab === 'user' && <UserSearch showMe={false} onPick={(u) => onPick({ type: 'user', id: u.accountId }, u.displayName)} />}
      {tab === 'schedule' && <ScheduleList onPick={(s) => onPick({ type: 'schedule', id: s.id }, s.name)} />}
      {tab === 'escalation' && <EscalationList alert={alert} onPick={(e) => onPick({ type: 'escalation', id: e.id }, e.name)} />}
    </div>
  );
}

export function EscalatePicker({ alert, onPick }: Readonly<{ alert: Alert; onPick: (escalationId: string, name: string) => void }>) {
  return (
    <div className="w-72 p-2">
      <EscalationList alert={alert} onPick={(e) => onPick(e.id, e.name)} />
    </div>
  );
}

// ---- Snooze -------------------------------------------------------------------

const SNOOZE_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h', minutes: 240 },
  { label: '8 h', minutes: 480 },
  { label: '24 h', minutes: 1440 },
];

function localInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SnoozePicker({ onPick }: Readonly<{ onPick: (endTime: string) => void }>) {
  const [custom, setCustom] = useState(() => localInputValue(Date.now() + 2 * 3_600_000));
  const customMs = Date.parse(custom);
  return (
    <div className="grid w-60 gap-2 p-2">
      <div className="grid grid-cols-3 gap-1">
        {SNOOZE_PRESETS.map((preset) => (
          <button
            key={preset.minutes}
            type="button"
            className="h-7 rounded-md border border-line-strong text-xs font-medium hover:bg-hover"
            onClick={() => onPick(new Date(Date.now() + preset.minutes * 60_000).toISOString())}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (Number.isFinite(customMs) && customMs >= Date.now() + 60_000 && customMs <= Date.now() + SNOOZE_MAX_DAYS * 86_400_000) onPick(new Date(customMs).toISOString());
        }}
      >
        <input type="datetime-local" aria-label="Snooze until" value={custom} min={localInputValue(Date.now())} onChange={(e) => setCustom(e.target.value)} className={input} />
        <button type="submit" disabled={!Number.isFinite(customMs) || customMs < Date.now() + 60_000 || customMs > Date.now() + SNOOZE_MAX_DAYS * 86_400_000} className="h-7 flex-none rounded-md bg-accent px-2 text-xs font-semibold text-on-accent disabled:opacity-50">
          Snooze
        </button>
      </form>
    </div>
  );
}

// ---- Priority -----------------------------------------------------------------

export function PriorityPicker({ current, onPick }: Readonly<{ current?: Priority; onPick: (priority: Priority) => void }>) {
  return (
    <div className="flex gap-1 p-2">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          aria-label={`Priority ${p}`}
          aria-pressed={p === current}
          disabled={p === current}
          onClick={() => onPick(p)}
          className="rounded-md p-1 hover:bg-hover disabled:cursor-default disabled:bg-accent-soft"
        >
          <PriorityBadge priority={p} />
        </button>
      ))}
    </div>
  );
}
