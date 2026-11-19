import { useState, type ReactNode } from 'react';
import { Ban, CalendarClock, ChevronDown, X } from 'lucide-react';
import type { AlertStatus, Priority } from '../../../shared/types';
import {
  DATE_PRESETS,
  NONE,
  PRIORITY_NAME,
  formatValue,
  type DateField,
  type SetField,
  type TextField,
} from '../../config/filterFields';
import { cn } from '../../lib/cn';
import {
  EMPTY_DATE,
  EMPTY_SET,
  isDateActive,
  isSetActive,
  isTextActive,
  type DateCondition,
  type FacetOption,
  type SetCondition,
} from '../../lib/filterEngine';
import { CustomerBadge, PriorityBadge, StatusBadge } from '../ui/badges';
import { Popover } from '../ui/Popover';

/** One control per filter kind (set, date, text). Which filters exist is decided by config/filterFields.ts. */

function shorten(values: string[], joiner = ', '): string {
  return values.length <= 2 ? values.join(joiner) : `${values[0]}${joiner}+${values.length - 1}`;
}

export function summarizeSet(field: SetField, condition: SetCondition): string {
  const label = (value: string) => (field.id === 'priority' ? value : formatValue(field, value));
  const parts: string[] = [];
  if (condition.include.length > 0) {
    parts.push(shorten(condition.include.map(label), field.multi && condition.match === 'all' ? ' + ' : ', '));
  }
  if (condition.exclude.length > 0) parts.push(`not ${shorten(condition.exclude.map(label))}`);
  return parts.join(' · ');
}

export function summarizeDate(condition: DateCondition): string {
  if (condition.preset !== 'custom') return DATE_PRESETS.find((p) => p.id === condition.preset)?.label ?? '';
  const part = (value: string) => (value ? value.replace('T', ' ') : '…');
  return `${part(condition.from)} → ${part(condition.to)}`;
}

function renderOption(field: SetField, value: string): ReactNode {
  if (value === NONE) return <span className="italic text-muted">{field.noneLabel ?? 'None'}</span>;
  if (field.id === 'priority') {
    return (
      <span className="flex items-center gap-2">
        <PriorityBadge priority={value as Priority} />
        {PRIORITY_NAME[value as Priority]}
      </span>
    );
  }
  if (field.id === 'status') return <StatusBadge status={value as AlertStatus} />;
  if (field.id === 'customer') return <CustomerBadge name={value} />;
  return <span className="truncate">{formatValue(field, value)}</span>;
}

interface TriggerProps {
  label: string;
  summary: string | null;
  open: boolean;
  onClear: () => void;
  icon?: ReactNode;
  buttonProps: Record<string, unknown>;
}

/** Filter button. When active it shows its value and a clear button. */
function Trigger({ label, summary, open, onClear, icon, buttonProps }: TriggerProps) {
  const active = summary !== null;
  return (
    <span
      className={cn(
        'flex h-7 items-stretch rounded-md border text-xs font-medium',
        active ? 'border-accent bg-accent-soft text-fg' : open ? 'border-line-strong bg-hover text-fg' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <button type="button" {...buttonProps} className="flex min-w-0 items-center gap-1 whitespace-nowrap pl-2 pr-1.5">
        {icon}
        {label}
        {active && <span className="max-w-56 truncate font-semibold">: {summary}</span>}
        {!active && <ChevronDown size={13} aria-hidden className="text-subtle" />}
      </button>
      {active && (
        <button
          type="button"
          aria-label={`Clear ${label} filter`}
          onClick={onClear}
          className="flex items-center rounded-r-md border-l border-accent/30 px-1 text-muted hover:bg-accent/15 hover:text-fg"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

interface SetFilterProps {
  field: SetField;
  options: FacetOption[];
  condition: SetCondition | undefined;
  onChange: (condition: SetCondition) => void;
  defaultOpen?: boolean;
}

export function SetFilter({ field, options, condition = EMPTY_SET, onChange, defaultOpen }: SetFilterProps) {
  const [query, setQuery] = useState('');
  const include = new Set(condition.include);
  const exclude = new Set(condition.exclude);

  // Selected values stay listed even when no alert currently has them.
  const known = new Set(options.map((o) => o.value));
  const all = [
    ...options,
    ...[...condition.include, ...condition.exclude].filter((v) => !known.has(v)).map((value) => ({ value, count: 0 })),
  ];
  const needle = query.trim().toLowerCase();
  const visible = needle ? all.filter((o) => formatValue(field, o.value).toLowerCase().includes(needle)) : all;

  const toggleInclude = (value: string) =>
    onChange({
      ...condition,
      include: include.has(value) ? condition.include.filter((v) => v !== value) : [...condition.include, value],
      exclude: condition.exclude.filter((v) => v !== value),
    });
  const toggleExclude = (value: string) =>
    onChange({
      ...condition,
      exclude: exclude.has(value) ? condition.exclude.filter((v) => v !== value) : [...condition.exclude, value],
      include: condition.include.filter((v) => v !== value),
    });

  return (
    <Popover
      label={`${field.label} filter`}
      className="w-72"
      defaultOpen={defaultOpen}
      trigger={(props, open) => (
        <Trigger
          label={field.label}
          summary={isSetActive(condition) ? summarizeSet(field, condition) : null}
          open={open}
          onClear={() => onChange(EMPTY_SET)}
          buttonProps={props}
        />
      )}
    >
      {() => (
        <div className="flex max-h-[min(440px,70vh)] flex-col">
          {(all.length > 8 || field.multi) && (
            <div className="flex items-center gap-1.5 border-b border-line p-1.5">
              {all.length > 8 && (
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find…"
                  aria-label={`Find ${field.label.toLowerCase()}`}
                  className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
                />
              )}
              {field.multi && (
                <div role="radiogroup" aria-label="Match" className="ml-auto flex flex-none overflow-hidden rounded border border-line-strong text-[11px] font-medium">
                  {(['any', 'all'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={condition.match === mode}
                      onClick={() => onChange({ ...condition, match: mode })}
                      className={cn('px-2 py-1', condition.match === mode ? 'bg-accent text-on-accent' : 'text-muted hover:bg-hover')}
                    >
                      {mode === 'any' ? 'Any' : 'All'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {visible.length === 0 && <li className="px-2 py-3 text-center text-xs text-subtle">No match</li>}
            {visible.map((option) => {
              const excluded = exclude.has(option.value);
              return (
                <li key={option.value} className="group flex items-center rounded hover:bg-hover">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 pl-2">
                    <input
                      type="checkbox"
                      className="size-3.5 flex-none accent-(--accent)"
                      checked={include.has(option.value)}
                      onChange={() => toggleInclude(option.value)}
                    />
                    <span className={cn('flex min-w-0 flex-1 items-center', excluded && 'line-through opacity-60')}>
                      {renderOption(field, option.value)}
                    </span>
                    <span className="flex-none text-[11px] tabular-nums text-subtle">{option.count}</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Exclude ${formatValue(field, option.value)}`}
                    aria-pressed={excluded}
                    data-tip="Exclude"
                    data-tip-always=""
                    onClick={() => toggleExclude(option.value)}
                    className={cn(
                      'mx-1 flex-none rounded p-1',
                      excluded ? 'bg-crit-soft text-crit' : 'text-subtle opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100',
                    )}
                  >
                    <Ban size={13} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}

interface DateFilterProps {
  field: DateField;
  condition: DateCondition | undefined;
  onChange: (condition: DateCondition) => void;
  defaultOpen?: boolean;
}

export function DateFilter({ field, condition = EMPTY_DATE, onChange, defaultOpen }: DateFilterProps) {
  return (
    <Popover
      label={`${field.label} date filter`}
      className="w-60"
      defaultOpen={defaultOpen}
      trigger={(props, open) => (
        <Trigger
          label={field.label}
          icon={<CalendarClock size={13} aria-hidden />}
          summary={isDateActive(condition) ? summarizeDate(condition) : null}
          open={open}
          onClear={() => onChange(EMPTY_DATE)}
          buttonProps={props}
        />
      )}
    >
      {() => (
        <fieldset className="p-1">
          <legend className="sr-only">{field.label}</legend>
          {DATE_PRESETS.map((preset) => (
            <label key={preset.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-hover">
              <input
                type="radio"
                name={`date-${field.id}`}
                className="size-3.5 accent-(--accent)"
                checked={condition.preset === preset.id}
                onChange={() => onChange({ ...condition, preset: preset.id })}
              />
              {preset.label}
            </label>
          ))}
          {condition.preset === 'custom' && (
            <div className="mt-1 grid gap-1.5 border-t border-line px-2 pb-1.5 pt-2">
              {(['from', 'to'] as const).map((edge) => (
                <label key={edge} className="grid gap-0.5 text-[11px] font-medium text-muted">
                  {edge === 'from' ? 'From' : 'To'}
                  <input
                    type="datetime-local"
                    value={condition[edge]}
                    max={edge === 'from' ? condition.to || undefined : undefined}
                    min={edge === 'to' ? condition.from || undefined : undefined}
                    onChange={(event) => onChange({ ...condition, [edge]: event.target.value })}
                    className="h-7 rounded border border-line-strong bg-bg px-1.5 text-xs text-fg"
                  />
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
    </Popover>
  );
}

interface TextFilterProps {
  field: TextField;
  value: string | undefined;
  onChange: (value: string) => void;
  defaultOpen?: boolean;
}

export function TextFilter({ field, value = '', onChange, defaultOpen }: TextFilterProps) {
  return (
    <Popover
      label={`${field.label} filter`}
      className="w-64 p-1.5"
      defaultOpen={defaultOpen}
      trigger={(props, open) => (
        <Trigger label={field.label} summary={isTextActive(value) ? value.trim() : null} open={open} onClear={() => onChange('')} buttonProps={props} />
      )}
    >
      {(close) => (
        <input
          type="search"
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') close();
          }}
          placeholder={field.placeholder}
          aria-label={field.label}
          className="h-7 w-full rounded border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
        />
      )}
    </Popover>
  );
}
