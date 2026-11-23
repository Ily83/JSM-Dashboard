import type { ReactNode } from 'react';
import { Bell, BellRing, ChevronsDownUp, ChevronsUpDown, CircleAlert, CircleCheck, FlaskConical, LayoutGrid, LoaderCircle, Moon, RefreshCw, Sun, type LucideIcon } from 'lucide-react';
import type { SyncMeta } from '../../shared/types';
import { cn } from '../lib/cn';
import { formatAbsolute, formatClock, formatRelative } from '../lib/format';
import { useNow } from '../lib/now';
import { MaintenanceIndicator } from './dashboard/opsWidgets';
import { SignOutButton } from './SignOutButton';
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
  canSignOut?: boolean;
  /** Customer scope control, on the alert pages only. */
  scope?: ReactNode;
  /** P1 alarm (sound and desktop notification) on or off. */
  alarm?: { on: boolean; tip: string; onToggle: () => void };
  /** Dashboard controls, absent on the settings page. */
  dashboard?: { collapsed: boolean; editing: boolean; onToggleCollapsed: () => void; onToggleEditing: () => void };
}

const iconButton = (active = false) =>
  cn(
    'flex size-7 items-center justify-center rounded-md border',
    active ? 'border-accent bg-accent-soft text-fg' : 'border-transparent text-muted hover:bg-hover hover:text-fg',
  );

type SyncProps = Pick<TopBarProps, 'meta' | 'isFetching' | 'requestError'>;

/** The icon beside the sync text: spinning while a request runs, then failed or fine. */
const SYNC_ICON = {
  fetching: { Icon: LoaderCircle, className: 'spin' },
  failed: { Icon: CircleAlert, className: 'text-crit' },
  synced: { Icon: CircleCheck, className: 'text-ok' },
} satisfies Record<string, { Icon: LucideIcon; className: string }>;

function syncIcon(isFetching: boolean, failed: boolean) {
  if (isFetching) return SYNC_ICON.fetching;
  return failed ? SYNC_ICON.failed : SYNC_ICON.synced;
}

function syncText({ meta, requestError }: SyncProps, failed: boolean, last: number | null, now: number): string {
  if (!meta && !requestError) return 'Loading…';
  if (failed) return last ? `Sync failed · last ${formatClock(last)}` : 'Sync failed';
  return last ? `Synced ${formatRelative(last, now)}` : 'Not synced yet';
}

function syncTip({ meta, requestError }: SyncProps, last: number | null): string {
  return [
    last ? `Last successful sync: ${formatAbsolute(last)}` : 'No successful sync yet',
    meta?.lastSyncDurationMs == null ? '' : `Duration: ${meta.lastSyncDurationMs} ms`,
    requestError ?? meta?.error ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

function SyncStatus(props: Readonly<SyncProps>) {
  const { meta, isFetching, requestError } = props;
  const now = useNow();
  const failed = requestError !== null || meta?.stale === true;
  const last = meta?.lastSyncAt ?? null;
  const { Icon, className } = syncIcon(isFetching, failed);
  return (
    <output
      className={cn('flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums', failed ? 'font-medium text-crit' : 'text-muted')}
      data-tip={syncTip(props, last)}
      data-tip-always=""
    >
      <Icon size={14} aria-hidden className={cn('flex-none', className)} />
      {/* On a phone the icon carries the state; the text stays for screen readers. */}
      <span className="max-sm:sr-only">{syncText(props, failed, last, now)}</span>
    </output>
  );
}

function label(seconds: number): string {
  if (seconds === 0) return 'Off';
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

export function TopBar(props: Readonly<TopBarProps>) {
  const { title, demo, refreshSeconds, onRefreshSecondsChange, onRefresh, isFetching, theme, onThemeChange, dashboard } = props;
  const dark = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  const options = (REFRESH_OPTIONS as readonly number[]).includes(refreshSeconds)
    ? REFRESH_OPTIONS
    : [...REFRESH_OPTIONS, refreshSeconds].sort((a, b) => a - b);

  return (
    <header className="flex h-11 flex-none items-center gap-2 border-b border-line bg-panel px-3 sm:gap-3">
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
          <span className="max-sm:sr-only">Demo mode</span>
        </span>
      )}

      {props.scope}
      <MaintenanceIndicator />

      <div className="ml-auto flex flex-none items-center gap-1.5">
        {props.showLiveControls !== false && (
          <>
            <SyncStatus meta={props.meta} isFetching={isFetching} requestError={props.requestError} />
            <label className="flex items-center max-sm:hidden">
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
            <span className="mx-0.5 h-5 w-px bg-line max-sm:hidden" aria-hidden />
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
              className={cn(iconButton(dashboard.editing), 'max-sm:hidden')}
            >
              <LayoutGrid size={15} aria-hidden />
            </button>
          </>
        )}
        {props.alarm && (
          <button
            type="button"
            onClick={props.alarm.onToggle}
            aria-pressed={props.alarm.on}
            aria-label="P1 alarm"
            data-tip={props.alarm.tip}
            data-tip-always=""
            className={props.alarm.on ? 'flex size-7 items-center justify-center rounded-md border border-transparent text-crit hover:bg-hover' : iconButton()}
          >
            {props.alarm.on ? <BellRing size={15} aria-hidden /> : <Bell size={15} aria-hidden />}
          </button>
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
        {props.canSignOut && <SignOutButton compact />}
      </div>
    </header>
  );
}
