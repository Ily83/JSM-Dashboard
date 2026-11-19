import { memo, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import type { Alert, AlertStatus, Priority } from '../../../shared/types';
import { formatAbsolute, formatRelative } from '../../lib/format';
import { useNow } from '../../lib/now';
import { COLUMN_INFO, type ColumnId } from '../../config/columns';
import { CustomerBadge, PriorityBadge, StatusBadge, TagChip } from '../ui/badges';

/** Display options that come from the user's preferences. */
export interface CellOptions {
  timeFormat: 'relative' | 'absolute';
  showTags: boolean;
  showOccurrences: boolean;
  /** Alerts the user watches: marked with a star. */
  watched?: ReadonlySet<string>;
}

const PRIORITY_RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
const STATUS_RANK: Record<AlertStatus, number> = { open: 0, acked: 1, snoozed: 2, closed: 3 };

const helper = createColumnHelper<Alert>();
const sized = (id: ColumnId) => ({ id, size: COLUMN_INFO[id].size, minSize: COLUMN_INFO[id].minSize, enableHiding: COLUMN_INFO[id].hideable });
const lower = (value: string | null) => (value ? value.toLowerCase() : undefined);

/**
 * Column definitions: sorting behaviour and sizes. Cell rendering is done by
 * renderCell() below, which lets rows be memoised on the alert object alone.
 */
export const COLUMNS = [
  helper.accessor((a) => PRIORITY_RANK[a.priority], { ...sized('priority'), sortDescFirst: false }),
  helper.accessor((a) => a.summary.toLowerCase(), { ...sized('summary'), sortDescFirst: false }),
  helper.accessor((a) => lower(a.customers.join(', ') || null), { ...sized('customers'), sortUndefined: 'last', sortDescFirst: false }),
  helper.accessor((a) => STATUS_RANK[a.status], { ...sized('status'), sortDescFirst: false }),
  helper.accessor((a) => lower(a.service), { ...sized('service'), sortUndefined: 'last', sortDescFirst: false }),
  helper.accessor((a) => lower(a.assignee), { ...sized('assignee'), sortUndefined: 'last', sortDescFirst: false }),
  helper.accessor((a) => a.createdAt, { ...sized('createdAt'), sortDescFirst: true }),
  helper.accessor((a) => a.updatedAt, { ...sized('updatedAt'), sortDescFirst: true }),
  helper.accessor((a) => a.source.toLowerCase(), { ...sized('source'), sortDescFirst: false }),
  helper.accessor((a) => (a.tinyId ? Number(a.tinyId) || 0 : undefined), { ...sized('tinyId'), sortUndefined: 'last', sortDescFirst: true }),
  helper.accessor((a) => a.count, { ...sized('count'), sortDescFirst: true }),
];

const NO_TAGS: string[] = [];
const Dash = () => <span className="text-subtle">–</span>;

/** Relative time that keeps itself current; the exact time is in the tooltip. */
function RelativeTime({ ms }: { ms: number }) {
  const now = useNow();
  return (
    <span className="truncate tabular-nums" data-tip={formatAbsolute(ms)} data-tip-always="">
      {formatRelative(ms, now)}
    </span>
  );
}

function TimeCell({ ms, format }: { ms: number; format: CellOptions['timeFormat'] }) {
  if (!ms) return <Dash />;
  if (format === 'relative') return <RelativeTime ms={ms} />;
  const text = formatAbsolute(ms);
  return (
    <span className="truncate tabular-nums" data-tip={text}>
      {text}
    </span>
  );
}

/**
 * Customer badges first, then other tags, on one line. How many fit is
 * estimated from the column width and text length (no DOM measurement, so it
 * costs nothing while scrolling); the rest is summarised as "+N" and listed
 * in the tooltip.
 */
const CustomersCell = memo(function CustomersCell({ customers, tags, width }: { customers: string[]; tags: string[]; width: number }) {
  if (customers.length === 0 && tags.length === 0) return <Dash />;

  const available = width - 18;
  const MORE = 34;
  const total = customers.length + tags.length;
  let used = 0;
  let shown = 0;
  for (let i = 0; i < total; i += 1) {
    const isCustomer = i < customers.length;
    const text = isCustomer ? customers[i]! : tags[i - customers.length]!;
    const itemWidth = (isCustomer ? text.length * 7.1 + 15 : text.length * 6.1 + 13) + 4;
    const reserve = i < total - 1 ? MORE : 0;
    if (used + itemWidth + reserve > available && shown > 0) break;
    used += itemWidth;
    shown += 1;
  }
  const hidden = total - shown;
  const shownCustomers = customers.slice(0, shown);
  const shownTags = tags.slice(0, Math.max(0, shown - customers.length));
  const tip = [
    customers.length > 0 ? `Customers: ${customers.join(', ')}` : '',
    tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      data-tip={tip}
      data-tip-always={hidden > 0 || used > available ? '' : undefined}
    >
      {shownCustomers.map((name, i) => (
        <CustomerBadge key={name} name={name} className={i === 0 ? 'shrink' : undefined} />
      ))}
      {shownTags.map((tag) => (
        <TagChip key={tag} tag={tag} />
      ))}
      {hidden > 0 && (
        <span className="flex-none rounded bg-hover px-1 text-[11px] font-semibold leading-[18px] text-muted">+{hidden}</span>
      )}
    </div>
  );
});

function AssigneeCell({ alert }: { alert: Alert }) {
  const teams = alert.responders
    .map((r) => r.name)
    .filter(Boolean)
    .join(', ');
  if (alert.assignee) {
    return (
      <span className="truncate" data-tip={teams ? `${alert.assignee}\nResponders: ${teams}` : alert.assignee}>
        {alert.assignee}
      </span>
    );
  }
  const closed = alert.status === 'closed';
  return (
    <span className="truncate" data-tip={teams ? `Unassigned\nResponders: ${teams}` : 'Unassigned'}>
      <span className={closed ? 'text-subtle' : 'font-medium text-warn'}>Unassigned</span>
      {teams && <span className="text-subtle"> · {teams}</span>}
    </span>
  );
}

export function renderCell(id: ColumnId, alert: Alert, width: number, options: CellOptions): ReactNode {
  switch (id) {
    case 'priority':
      return <PriorityBadge priority={alert.priority} />;
    case 'summary':
      return (
        <>
          {options.watched?.has(alert.id) && <Star size={12} aria-label="Watching" fill="currentColor" className="flex-none text-warn" />}
          <span className="truncate font-medium" data-tip={alert.summary}>
            {alert.summary}
          </span>
          {options.showOccurrences && alert.count > 1 && (
            <span
              className="flex-none rounded-full border border-line-strong px-1.5 text-[11px] leading-4 tabular-nums text-muted"
              data-tip={`${alert.count} occurrences (de-duplicated)`}
              data-tip-always=""
            >
              ×{alert.count}
            </span>
          )}
        </>
      );
    case 'customers':
      return <CustomersCell customers={alert.customers} tags={options.showTags ? alert.tags : NO_TAGS} width={width} />;
    case 'status':
      return <StatusBadge status={alert.status} />;
    case 'service':
      return alert.service ? (
        <span className="truncate" data-tip={alert.service}>
          {alert.service}
        </span>
      ) : (
        <Dash />
      );
    case 'assignee':
      return <AssigneeCell alert={alert} />;
    case 'createdAt':
      return <TimeCell ms={alert.createdAt} format={options.timeFormat} />;
    case 'updatedAt':
      return <TimeCell ms={alert.updatedAt} format={options.timeFormat} />;
    case 'source':
      return (
        <span className="truncate text-muted" data-tip={alert.rawSource && alert.rawSource !== alert.source ? `${alert.source}\nSource: ${alert.rawSource}` : alert.source}>
          {alert.source}
        </span>
      );
    case 'tinyId':
      return alert.tinyId ? <span className="truncate font-mono text-xs text-muted">#{alert.tinyId}</span> : <Dash />;
    case 'count':
      return <span className="tabular-nums">{alert.count}</span>;
  }
}
