import type { ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown, CircleAlert, CircleCheck, FlaskConical, LayoutGrid, LoaderCircle, Moon, RefreshCw, Sun } from 'lucide-react';
import type { SyncMeta } from '../../shared/types';
import { cn } from '../lib/cn';
import { formatAbsolute, formatClock, formatRelative } from '../lib/format';
import { useNow } from '../lib/now';
import { REFRESH_OPTIONS, type Theme } from '../state/prefs';

interface TopBarProps {
  title: string;
  demo: boolean;
  meta: SyncMeta | undefined;
  isFetching: boolean;
  /** Error of the request to our own backend (not of the Jira synchronisation). */
  requestError: string | null;
  refreshSeconds: number;
  onRefreshSecondsChange: (seconds: number) => void;
  onRefresh: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  showLiveControls?: boolean;
  /** Customer scope control, on the alert pages only. */
  scope?: ReactNode;
  /** Dashboard controls, absent on the settings page. */
  dashboard?: { collapsed: boolean; editing: boolean; onToggleCollapsed: () => void; onToggleEditing: () => void };
}

const iconButton = (active = false) =>
  cn(
    'flex size-7 items-center justify-center rounded-md border',
    active ? 'border-accent bg-accent-soft text-fg' : 'border-transparent text-muted hover:bg-hover hover:text-fg',
  );

function SyncStatus({ meta, isFetching, requestError }: Pick<TopBarProps, 'meta' | 'isFetching' | 'requestError'>) {
  const now = useNow();
  const failed = requestError !== null || meta?.stale === true;
  const last = meta?.lastSyncAt ?? null;

  let text: string;
  if (!meta && !requestError) text = 'Loading…';
  else if (failed) text = last ? `Sync failed · last ${formatClock(last)}` : 'Sync failed';
  else text = last ? `Synced ${formatRelative(last, now)}` : 'Not synced yet';

  const tip = [
    last ? `Last successful sync: ${formatAbsolute(last)}` : 'No successful sync yet',
    meta?.lastSyncDurationMs != null ? `Duration: ${meta.lastSyncDurationMs} ms` : '',
    requestError ?? meta?.error ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const Icon = isFetching ? LoaderCircle : failed ? CircleAlert : CircleCheck;
  return (
    <span
      className={cn('flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums', failed ? 'font-medium text-crit' : 'text-muted')}
      data-tip={tip}
      data-tip-always=""
      role="status"
    >
      <Icon size={14} aria-hidden className={cn('flex-none', isFetching ? 'spin' : failed ? 'text-crit' : 'text-ok')} />
      {text}
    </span>
  );
}

const label = (seconds: number) => (seconds === 0 ? 'Off' : seconds < 60 ? `${seconds}s` : `${seconds / 60}m`);

export function TopBar(props: TopBarProps) {
  const { title, demo, refreshSeconds, onRefreshSecondsChange, onRefresh, isFetching, theme, onThemeChange, dashboard } = props;
  const dark = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  const options = (REFRESH_OPTIONS as readonly number[]).includes(refreshSeconds)
    ? REFRESH_OPTIONS
    : [...REFRESH_OPTIONS, refreshSeconds].sort((a, b) => a - b);

  return (
    <header className="flex h-11 flex-none items-center gap-3 border-b border-line bg-panel px-3">
      <h1 className="flex min-w-0 items-baseline gap-2 text-sm font-semibold">
        <span className="truncate max-md:hidden">Jira Operations – Alert Center</span>
        <span className="text-subtle max-md:hidden" aria-hidden>
          /
        </span>
        <span className="truncate font-medium text-muted">{title}</span>
      </h1>

      {demo && (
        <span
          className="flex flex-none items-center gap-1.5 rounded border border-warn/60 bg-warn-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn"
          data-tip="Sample data. No connection to Jira."
          data-tip-always=""
        >
          <FlaskConical size={12} aria-hidden />
          Demo mode
        </span>
      )}

      {props.scope}

      <div className="ml-auto flex flex-none items-center gap-1.5">
        {props.showLiveControls !== false && (
          <>
            <SyncStatus meta={props.meta} isFetching={isFetching} requestError={props.requestError} />
            <label className="flex items-center">
              <span className="sr-only">Auto-refresh interval</span>
              <select
                value={refreshSeconds}
                onChange={(event) => onRefreshSecondsChange(Number(event.target.value))}
                className="h-7 rounded-md border border-line-strong bg-panel px-1.5 text-xs text-fg"
                data-tip="Auto-refresh"
                data-tip-always=""
              >
                {options.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {label(seconds)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={onRefresh} disabled={isFetching} aria-label="Refresh now" data-tip="Refresh now" data-tip-always="" className={iconButton()}>
              <RefreshCw size={15} aria-hidden className={cn(isFetching && 'spin')} />
            </button>
          </>
        )}

        {dashboard && (
          <>
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <button
              type="button"
              onClick={dashboard.onToggleCollapsed}
              aria-pressed={!dashboard.collapsed}
              aria-label={dashboard.collapsed ? 'Show dashboard' : 'Hide dashboard'}
              data-tip={dashboard.collapsed ? 'Show dashboard' : 'Hide dashboard'}
              data-tip-always=""
              className={iconButton()}
            >
              {dashboard.collapsed ? <ChevronsUpDown size={15} aria-hidden /> : <ChevronsDownUp size={15} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={dashboard.onToggleEditing}
              aria-pressed={dashboard.editing}
              aria-label="Customize dashboard"
              data-tip="Customize dashboard"
              data-tip-always=""
              className={iconButton(dashboard.editing)}
            >
              <LayoutGrid size={15} aria-hidden />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onThemeChange(dark ? 'light' : 'dark')}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          data-tip={dark ? 'Light theme' : 'Dark theme'}
          data-tip-always=""
          className={iconButton()}
        >
          {dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
        </button>
      </div>
    </header>
  );
}
