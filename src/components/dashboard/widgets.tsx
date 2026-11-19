import type { ComponentType, ReactNode } from 'react';
import { PRIORITIES, type Priority } from '../../../shared/types';
import type { SetFieldId } from '../../config/filterFields';
import type { SectionId } from '../../config/sections';
import type { WidgetId } from '../../config/widgets';
import { cn } from '../../lib/cn';
import { formatAge } from '../../lib/format';
import { useNow } from '../../lib/now';
import type { DashboardStats, Ranked } from '../../lib/stats';
import { CustomerBadge, PriorityBadge } from '../ui/badges';

/**
 * Widget components, one per id in config/widgets.ts. Each receives the
 * precomputed statistics, its size in grid units and a few actions; it holds
 * no data-fetching or layout logic of its own.
 */

export interface WidgetActions {
  showSection: (section: SectionId) => void;
  /** Shows active alerts restricted to one value of one filter. */
  filterBy: (field: SetFieldId, value: string) => void;
  openAlert: (id: string) => void;
}

export interface WidgetProps {
  stats: DashboardStats;
  w: number;
  h: number;
  /** Pixel height of the content area. */
  height: number;
  actions: WidgetActions;
}

interface KpiProps {
  label: string;
  value: number;
  hint?: ReactNode;
  tone?: 'crit' | 'warn' | 'info' | 'ok';
  onClick?: () => void;
}

const TONE: Record<NonNullable<KpiProps['tone']>, string> = {
  crit: 'text-crit',
  warn: 'text-warn',
  info: 'text-info',
  ok: 'text-ok',
};

function Kpi({ label, value, hint, tone, onClick }: KpiProps) {
  const alarming = tone === 'crit' && value > 0;
  const body = (
    <>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn('text-2xl font-semibold leading-none tabular-nums', value > 0 && tone ? TONE[tone] : 'text-fg')}>
          {value.toLocaleString()}
        </span>
        {hint && <span className="min-w-0 truncate text-xs text-subtle">{hint}</span>}
      </span>
    </>
  );
  const className = cn(
    'flex h-full w-full min-w-0 flex-col justify-between rounded-md border bg-panel px-3 py-2 text-left',
    alarming ? 'border-crit/60 shadow-[inset_3px_0_0_var(--crit)]' : 'border-line',
    onClick && 'hover:bg-hover',
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-md border border-line bg-panel">
      <h3 className="flex-none truncate px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 pb-1.5">{children}</div>
    </section>
  );
}

const ROW = 24;

function RankedList({ items, height, onPick, asBadge }: { items: Ranked[]; height: number; onPick: (name: string) => void; asBadge?: boolean }) {
  if (items.length === 0) return <p className="px-1.5 py-1 text-xs text-subtle">None</p>;
  const rows = Math.max(1, Math.floor((height - 30) / ROW));
  const max = items[0]!.count;
  return (
    <ul>
      {items.slice(0, rows).map((item) => (
        <li key={item.name}>
          <button
            type="button"
            onClick={() => onPick(item.name)}
            className="flex w-full items-center gap-2 rounded px-1.5 hover:bg-hover"
            style={{ height: ROW }}
          >
            <span className="flex w-2/5 min-w-0 flex-none items-center text-left text-xs">
              {asBadge ? <CustomerBadge name={item.name} className="shrink" /> : <span className="truncate">{item.name}</span>}
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-hover" aria-hidden>
              <span className="flex h-full" style={{ width: `${(item.count / max) * 100}%` }}>
                <span className="h-full bg-crit" style={{ width: `${(item.critical / item.count) * 100}%` }} />
                <span className="h-full flex-1 bg-accent/70" />
              </span>
            </span>
            <span className="w-7 flex-none text-right text-xs font-semibold tabular-nums">{item.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const PRIORITY_VAR: Record<Priority, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)', P5: 'var(--p5)' };

function PriorityBreakdown({ stats, actions }: WidgetProps) {
  const total = stats.active;
  return (
    <Panel title="Alerts by priority">
      <div className="flex h-full flex-col justify-center gap-2 px-1.5">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-hover" aria-hidden>
          {PRIORITIES.map((p) =>
            stats.byPriority[p] > 0 ? (
              <span key={p} style={{ width: `${(stats.byPriority[p] / total) * 100}%`, background: PRIORITY_VAR[p] }} className="h-full border-r border-panel last:border-r-0" />
            ) : null,
          )}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {PRIORITIES.map((p) => (
            <li key={p}>
              <button type="button" onClick={() => actions.filterBy('priority', p)} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-hover">
                <PriorityBadge priority={p} />
                <span className="text-xs font-semibold tabular-nums">{stats.byPriority[p]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Attention({ stats, height, actions }: WidgetProps) {
  const now = useNow();
  const rows = Math.max(1, Math.floor((height - 30) / ROW));
  return (
    <Panel title="Waiting longest">
      {stats.attention.length === 0 ? (
        <p className="px-1.5 py-1 text-xs text-subtle">Nothing waiting</p>
      ) : (
        <ul>
          {stats.attention.slice(0, rows).map((alert) => (
            <li key={alert.id}>
              <button
                type="button"
                onClick={() => actions.openAlert(alert.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 text-left hover:bg-hover"
                style={{ height: ROW }}
              >
                <PriorityBadge priority={alert.priority} />
                <span className="min-w-0 flex-1 truncate text-xs" data-tip={alert.summary}>
                  {alert.summary}
                </span>
                {alert.customers[0] && <CustomerBadge name={alert.customers[0]} className="max-w-28 shrink" />}
                <span className="w-14 flex-none text-right text-xs tabular-nums text-muted">{formatAge(alert.createdAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export const WIDGET_COMPONENTS: Record<WidgetId, ComponentType<WidgetProps>> = {
  kpiActive: ({ stats, actions }) => (
    <Kpi label="Active alerts" value={stats.active} hint={`${stats.open} open`} onClick={() => actions.showSection('active')} />
  ),
  kpiCritical: ({ stats, actions }) => (
    <Kpi
      label="Critical"
      value={stats.critical}
      tone="crit"
      hint={stats.criticalUnacked > 0 ? `${stats.criticalUnacked} unacked` : undefined}
      onClick={() => actions.showSection('critical')}
    />
  ),
  kpiHigh: ({ stats, actions }) => (
    <Kpi
      label="High priority"
      value={stats.high}
      tone="warn"
      hint={stats.highUnacked > 0 ? `${stats.highUnacked} unacked` : undefined}
      onClick={() => actions.filterBy('priority', 'P2')}
    />
  ),
  kpiCustomers: ({ stats, w }) => (
    <Kpi
      label="Affected customers"
      value={stats.customers.length}
      hint={
        w >= 3 && stats.customers.length > 0 ? (
          <span className="flex gap-1 overflow-hidden">
            {stats.customers.slice(0, w).map((c) => (
              <CustomerBadge key={c.name} name={c.name} />
            ))}
          </span>
        ) : undefined
      }
    />
  ),
  kpiUnassigned: ({ stats, actions }) => (
    <Kpi
      label="Unassigned"
      value={stats.unassigned}
      tone="warn"
      hint={stats.unassignedUrgent > 0 ? `${stats.unassignedUrgent} P1/P2` : undefined}
      onClick={() => actions.filterBy('assignee', '')}
    />
  ),
  kpiAcked: ({ stats, actions }) => (
    <Kpi label="Acknowledged" value={stats.acked} tone="info" onClick={() => actions.showSection('acknowledged')} />
  ),
  topCustomers: ({ stats, height, actions }) => (
    <Panel title="Alerts by customer">
      <RankedList items={stats.customers} height={height} asBadge onPick={(name) => actions.filterBy('customer', name)} />
    </Panel>
  ),
  priorityBreakdown: PriorityBreakdown,
  topServices: ({ stats, height, actions }) => (
    <Panel title="Alerts by service">
      <RankedList items={stats.services} height={height} onPick={(name) => actions.filterBy('service', name)} />
    </Panel>
  ),
  topSources: ({ stats, height, actions }) => (
    <Panel title="Alerts by source">
      <RankedList items={stats.sources} height={height} onPick={(name) => actions.filterBy('source', name)} />
    </Panel>
  ),
  attention: Attention,
};
