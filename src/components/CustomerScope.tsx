import { useState } from 'react';
import { Building2, ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { isInScope, toggleScope, type CustomerOption } from '../lib/customerScope';
import { MAX_SCOPE_CUSTOMERS } from '../state/prefs';
import { CustomerBadge } from './ui/badges';
import { Popover, type PopoverTriggerProps } from './ui/Popover';

interface CustomerScopeProps {
  options: CustomerOption[];
  /** Selected customers; empty means all. */
  scope: string[];
  /** The profile's customers, offered as a one-click selection. */
  myCustomers: string[];
  onChange: (scope: string[]) => void;
}

function scopeLabel(scope: readonly string[]): string {
  if (scope.length === 0) return 'All customers';
  if (scope.length === 1) return scope[0];
  return `${scope[0]} +${scope.length - 1}`;
}

/** The chip that opens the scope popover. */
function renderScopeButton(props: PopoverTriggerProps, open: boolean, scope: readonly string[]) {
  const scoped = scope.length > 0;
  const tip = scoped ? `Dashboard and table: ${scope.join(', ')}` : 'Dashboard and table: all customers';
  return (
    <button
      type="button"
      {...props}
      data-tip={tip}
      data-tip-always=""
      aria-label={`Customer scope: ${scoped ? scope.join(', ') : 'all customers'}`}
      className={cn(
        'flex h-7 max-w-56 items-center gap-1.5 border px-2 text-xs font-medium',
        scoped ? 'rounded-l-md border-accent bg-accent-soft text-fg' : 'rounded-md',
        !scoped && (open ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg'),
      )}
    >
      <Building2 size={14} aria-hidden className={cn('flex-none', scoped && 'text-accent')} />
      <span className="truncate max-md:hidden">{scopeLabel(scope)}</span>
      <ChevronDown size={12} aria-hidden className="flex-none text-subtle max-md:hidden" />
    </button>
  );
}

/**
 * The customer scope chip. Shows whether dashboard and table cover all
 * customers or a selection, and changes it without touching the saved views.
 */
export function CustomerScope({ options, scope, myCustomers, onChange }: Readonly<CustomerScopeProps>) {
  const [query, setQuery] = useState('');
  const scoped = scope.length > 0;
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const sameAsMine =
    myCustomers.length > 0 && myCustomers.length === scope.length && myCustomers.every((name) => isInScope(name, scope));

  return (
    <div className="flex flex-none items-center">
      <Popover
        label="Customer scope"
        className="w-64"
        onOpenChange={(open) => {
          if (!open) setQuery('');
        }}
        trigger={(props, open) => renderScopeButton(props, open, scope)}
      >
        {() => (
          <div className="flex max-h-[70vh] flex-col">
            {options.length > 8 && (
              <div className="border-b border-line p-2">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find customer"
                  aria-label="Find customer"
                  className="h-7 w-full rounded-md border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
                />
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-auto p-1" aria-label="Customers">
              {shown.length === 0 && <li className="px-2 py-2 text-xs text-subtle">No customers</li>}
              {shown.map((option) => {
                const checked = isInScope(option.name, scope);
                const full = !checked && scope.length >= MAX_SCOPE_CUSTOMERS;
                return (
                  <li key={option.name}>
                    <label className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-hover', full && 'cursor-not-allowed opacity-50')}>
                      <input
                        type="checkbox"
                        className="size-3.5 flex-none accent-(--accent)"
                        checked={checked}
                        disabled={full}
                        onChange={() => onChange(toggleScope(scope, option.name))}
                      />
                      <CustomerBadge name={option.name} className="min-w-0 truncate" />
                      <span className="ml-auto flex-none text-[11px] tabular-nums text-subtle" data-tip="Active alerts" data-tip-always="">
                        {option.active}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-1 border-t border-line p-1.5">
              {myCustomers.length > 0 && (
                <button
                  type="button"
                  disabled={sameAsMine}
                  onClick={() => onChange(myCustomers.slice(0, MAX_SCOPE_CUSTOMERS))}
                  className="h-6 rounded px-2 text-xs font-medium text-accent hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  My customers
                </button>
              )}
              <button
                type="button"
                disabled={!scoped}
                onClick={() => onChange([])}
                className="ml-auto h-6 rounded px-2 text-xs font-medium text-accent hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
              >
                All customers
              </button>
            </div>
          </div>
        )}
      </Popover>
      {scoped && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="Show all customers"
          data-tip="Show all customers"
          data-tip-always=""
          className="flex h-7 flex-none items-center rounded-r-md border border-l-0 border-accent bg-accent-soft px-1.5 text-muted hover:text-fg"
        >
          <X size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}
