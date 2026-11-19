import { memo, type CSSProperties } from 'react';
import { BellOff, CheckCheck, CircleCheck, CircleDot } from 'lucide-react';
import type { AlertStatus, Priority } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { customerHue } from '../../lib/customerColor';
import { STATUS_LABEL } from '../../config/filterFields';

const PRIORITY_STYLE: Record<Priority, CSSProperties> = {
  P1: { background: 'var(--p1)', color: 'var(--panel)', borderColor: 'var(--p1)' },
  P2: { background: 'color-mix(in srgb, var(--p2) 18%, transparent)', color: 'var(--p2)', borderColor: 'var(--p2)' },
  P3: { background: 'transparent', color: 'var(--p3)', borderColor: 'color-mix(in srgb, var(--p3) 60%, transparent)' },
  P4: { background: 'transparent', color: 'var(--p4)', borderColor: 'color-mix(in srgb, var(--p4) 50%, transparent)' },
  P5: { background: 'transparent', color: 'var(--p5)', borderColor: 'var(--line-strong)' },
};

/** The priority is always written out (P1..P5); colour only reinforces it. */
export const PriorityBadge = memo(function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className="inline-flex h-[18px] w-8 flex-none items-center justify-center rounded border text-[11px] font-bold tabular-nums"
      style={PRIORITY_STYLE[priority]}
    >
      {priority}
    </span>
  );
});

const STATUS_STYLE: Record<AlertStatus, { icon: typeof CircleDot; className: string }> = {
  open: { icon: CircleDot, className: 'text-crit' },
  acked: { icon: CheckCheck, className: 'text-info' },
  snoozed: { icon: BellOff, className: 'text-violet' },
  closed: { icon: CircleCheck, className: 'text-ok' },
};

export const StatusBadge = memo(function StatusBadge({ status }: { status: AlertStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  const label = STATUS_LABEL[status];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-medium', className)}>
      <Icon size={13} strokeWidth={2.25} aria-hidden className="flex-none" />
      <span className="truncate">{label}</span>
    </span>
  );
});

export const CustomerBadge = memo(function CustomerBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('customer-badge', className)} style={{ '--h': customerHue(name) } as CSSProperties}>
      {name}
    </span>
  );
});

export function TagChip({ tag }: { tag: string }) {
  return <span className="tag-chip">{tag}</span>;
}
