import type { ComponentProps } from 'react';
import { Check, SquareSplitVertical } from 'lucide-react';
import { cn } from '../../lib/cn';
import { LANE_FIELDS, LANE_LABEL, type LaneBy } from '../../lib/tableItems';
import { Popover } from '../ui/Popover';

/** The menu button: shows the current lane field when lanes are on. */
function lanesTrigger(value: LaneBy): ComponentProps<typeof Popover>['trigger'] {
  const on = value !== 'off';
  return (props) => (
    <button
      type="button"
      {...props}
      aria-label={on ? `Lanes by ${LANE_LABEL[value].toLowerCase()}` : 'Lanes'}
      data-tip={on ? `Lanes: ${LANE_LABEL[value]}` : 'Lanes'}
      data-tip-always=""
      className={cn(
        'flex size-7 items-center justify-center rounded-md border hover:bg-hover hover:text-fg',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-panel text-muted',
      )}
    >
      <SquareSplitVertical size={15} aria-hidden />
    </button>
  );
}

/** Chooses whether and how the table is split into lanes. */
export function LanesMenu({ value, onChange }: Readonly<{ value: LaneBy; onChange: (value: LaneBy) => void }>) {
  return (
    <Popover
      label="Lanes"
      align="end"
      className="w-40 p-1"
      trigger={lanesTrigger(value)}
    >
      {(close) => (
        <div role="radiogroup" aria-label="Lanes by">
          {LANE_FIELDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value === id}
              onClick={() => {
                onChange(id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover"
            >
              <Check size={13} aria-hidden className={cn('flex-none', value === id ? 'text-accent' : 'invisible')} />
              {LANE_LABEL[id]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
