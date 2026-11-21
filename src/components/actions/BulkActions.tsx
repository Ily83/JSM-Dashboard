import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, CircleCheck, Ellipsis, ListChecks, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { ACTION_LABEL, BULK_ACTION_IDS, type ActionId, type AlertAction, type BulkActionId } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';
import { applyActionResult, refreshAlerts } from '../../api/hooks';
import { postAction } from '../../api/client';
import { cn } from '../../lib/cn';
import { button, confirmCloseButton, iconButton, primaryButton, quietButton } from '../ui/buttons';
import { anchorFromRect } from '../ui/menuPlacement';
import { Popover } from '../ui/Popover';
import { AlertMenu, type AlertContextMenu } from './AlertMenu';
import { appliesTo, needsConfirm, questionText, resultText, type BulkOperation } from './bulkRules';

export { appliesTo } from './bulkRules';
export type { AlertContextMenu } from './AlertMenu';

/**
 * The bulk bar above the table, and the alert menu it owns.
 *
 * The bar is always there, one line high, so selecting the first row moves
 * nothing. It holds the selection count, Acknowledge, Unacknowledge and
 * Close for the selection, More actions (the alert menu, for touch and
 * keyboard), the progress of a running action and the last outcome.
 *
 * The API acts on one alert per request, so the alerts are sent one by one
 * (three at a time). Alerts the action does not apply to are skipped up
 * front, the count is confirmed before anything is sent to more than one
 * alert, and the outcome is reported per alert.
 */

const CONCURRENCY = 3;

const ICON = { acknowledge: CheckCheck, unacknowledge: RotateCcw, close: CircleCheck } as const;

interface Failure {
  alert: Alert;
  message: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; request: AlertAction; targets: Alert[]; skipped: number; from: BulkActionId }
  | { kind: 'running'; action: BulkOperation; total: number; done: number };

interface Outcome {
  id: number;
  request: AlertAction;
  name?: string;
  ok: number;
  pending: number;
  failures: Failure[];
  skipped: number;
}

export async function runBulk(
  action: BulkOperation,
  targets: readonly Alert[],
  send: (alert: Alert) => Promise<'done' | 'pending'>,
  onProgress: (done: number) => void,
): Promise<{ ok: number; pending: number; failures: Failure[] }> {
  let next = 0;
  let finished = 0;
  let ok = 0;
  let pending = 0;
  const failures: Failure[] = [];
  const worker = async () => {
    while (next < targets.length) {
      const alert = targets[next++];
      try {
        if ((await send(alert)) === 'done') ok += 1;
        else pending += 1;
      } catch (error) {
        failures.push({ alert, message: error instanceof Error ? error.message : `${ACTION_LABEL[action]} failed.` });
      }
      finished += 1;
      onProgress(finished);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return { ok, pending, failures };
}

/** Where focus goes when the control that had it disappears: the table's current row. */
function focusTable(): void {
  document.querySelector<HTMLElement>('[role="grid"][aria-label="Alerts"] .at-row[tabindex="0"]')?.focus({ preventScroll: true });
}

function FailureList({ failures }: Readonly<{ failures: Failure[] }>) {
  return (
    <ul className="grid max-h-56 w-80 gap-1 overflow-y-auto p-2 text-[11px]">
      {failures.map((failure) => (
        <li key={failure.alert.id} className="flex gap-1.5">
          <TriangleAlert size={11} aria-hidden className="mt-0.5 flex-none text-crit" />
          <span className="flex-none font-mono">{failure.alert.tinyId ? `#${failure.alert.tinyId}` : failure.alert.id.slice(0, 8)}</span>
          <span className="min-w-0 truncate text-muted" data-tip={`${failure.alert.summary}\n${failure.message}`}>
            {failure.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The last outcome as one muted line of text (inside the live region): what happened, pending and skipped counts. */
function OutcomeText({ outcome }: Readonly<{ outcome: Outcome }>) {
  const failed = outcome.failures.length;
  const text = outcome.ok > 0 ? resultText(outcome.request, outcome.ok, outcome.name) : null;
  return (
    <>
      {failed > 0 ? <TriangleAlert size={13} aria-hidden className="flex-none text-crit" /> : <Check size={13} aria-hidden className="flex-none text-ok" />}
      {text && (
        <span className="min-w-0 truncate" data-tip={text}>
          {text}
        </span>
      )}
      {outcome.pending > 0 && (
        <span className="flex-none text-warn" data-tip="Sent, not confirmed by Jira yet" data-tip-always="">
          {outcome.pending} pending
        </span>
      )}
      {failed > 0 && <span className="sr-only">{failed} failed</span>}
      {outcome.skipped > 0 && (
        <span className="flex-none" data-tip="Not applicable or closed" data-tip-always="">
          {outcome.skipped} skipped
        </span>
      )}
    </>
  );
}

/** Failures stay one click away: the list opens under the count. */
function FailedButton({ failures }: Readonly<{ failures: Failure[] }>) {
  return (
    <Popover
      label="Failed alerts"
      trigger={(props) => (
        <button type="button" {...props} className="flex-none rounded px-1 py-0.5 font-semibold text-crit underline-offset-2 hover:bg-hover hover:underline active:bg-line">
          {failures.length} failed
        </button>
      )}
    >
      {() => <FailureList failures={failures} />}
    </Popover>
  );
}

export function BulkActionBar({
  selected,
  allowed,
  onClear,
  contextMenu,
  onOpenMenu,
  onCloseMenu,
  onOpenAlert,
}: Readonly<{
  selected: Alert[];
  allowed: ReadonlySet<ActionId>;
  onClear: () => void;
  contextMenu: AlertContextMenu | null;
  onOpenMenu: (menu: AlertContextMenu) => void;
  onCloseMenu: () => void;
  onOpenAlert: (id: string) => void;
}>) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const questionId = useId();
  const has = selected.length > 0;
  const busy = phase.kind === 'running';

  // A pending question is dropped when the selection changes or a menu opens.
  const selectionKey = selected.map((alert) => alert.id).sort().join('\0');
  const currentSelection = useRef(selectionKey);
  useEffect(() => {
    if (currentSelection.current === selectionKey) return;
    currentSelection.current = selectionKey;
    setPhase((current) => (current.kind === 'confirm' ? { kind: 'idle' } : current));
  }, [selectionKey]);
  useEffect(() => {
    if (contextMenu) setPhase((current) => (current.kind === 'confirm' ? { kind: 'idle' } : current));
  }, [contextMenu]);
  useEffect(() => {
    if (!has && contextMenu) onCloseMenu();
  }, [has, contextMenu, onCloseMenu]);

  // Focus requested for a bar button that is only rendered on the next commit.
  const buttons = useRef(new Map<BulkActionId, HTMLButtonElement>());
  const focusNext = useRef<BulkActionId | null>(null);
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    buttons.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  });

  // A new key for each opened menu, so a menu opened over another starts fresh.
  const menuKeys = useRef(new WeakMap<AlertContextMenu, number>());
  const lastMenuKey = useRef(0);
  let menuKey = 0;
  if (contextMenu) {
    menuKey = menuKeys.current.get(contextMenu) ?? ++lastMenuKey.current;
    menuKeys.current.set(contextMenu, menuKey);
  }

  const run = async (request: AlertAction, name: string | undefined, targets: Alert[], skipped: number) => {
    const action = request.action;
    const startedWith = currentSelection.current;
    setOutcome(null);
    setPhase({ kind: 'running', action, total: targets.length, done: 0 });
    const result = await runBulk(
      action,
      targets,
      async (alert) => {
        const response = await postAction(alert.id, request);
        applyActionResult(queryClient, alert.id, response);
        return response.result.state;
      },
      (done) => setPhase({ kind: 'running', action, total: targets.length, done }),
    );
    if (result.ok > 0 || result.pending > 0) void refreshAlerts(queryClient);
    setPhase({ kind: 'idle' });
    setOutcome({ id: Date.now(), request, name, skipped, ...result });
    if (result.failures.length === 0 && currentSelection.current === startedWith) onClear();
  };

  const fromBar = (action: BulkActionId) => {
    const targets = selected.filter((alert) => appliesTo(action, alert));
    if (busy || targets.length === 0) return;
    const skipped = selected.length - targets.length;
    if (needsConfirm(action, targets.length)) setPhase({ kind: 'confirm', request: { action }, targets, skipped, from: action });
    else void run({ action }, undefined, targets, skipped);
  };

  const moreButton = useRef<HTMLButtonElement>(null);
  const menuFromButton = contextMenu !== null && contextMenu.trigger === moreButton.current && moreButton.current !== null;
  const toggleMenu = () => {
    const trigger = moreButton.current;
    if (!trigger || !has) return;
    if (menuFromButton) {
      onCloseMenu();
      return;
    }
    onOpenMenu({
      anchor: anchorFromRect(trigger.getBoundingClientRect()),
      alertId: selected.length === 1 ? selected[0].id : null,
      restoreFocus: () => trigger.focus({ preventScroll: true }),
      trigger,
    });
  };

  const actions = BULK_ACTION_IDS.filter((id) => allowed.has(id));
  const shownOutcome = phase.kind === 'running' ? null : outcome;

  let main: ReactNode;
  if (phase.kind === 'confirm') {
    const back = () => {
      focusNext.current = phase.from;
      setPhase({ kind: 'idle' });
    };
    main = (
      <div
        className="flex min-w-0 items-center gap-2"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          back();
        }}
      >
        <span id={questionId} className="min-w-0 truncate font-semibold" data-tip={questionText(phase.request, phase.targets.length)}>
          {questionText(phase.request, phase.targets.length)}
        </span>
        {phase.skipped > 0 && (
          <span className="flex-none text-muted" data-tip="Not applicable or closed" data-tip-always="">
            {phase.skipped} skipped
          </span>
        )}
        <button
          type="button"
          autoFocus
          aria-describedby={questionId}
          className={phase.request.action === 'close' ? confirmCloseButton : primaryButton}
          onClick={() => {
            focusNext.current = phase.from;
            void run(phase.request, undefined, phase.targets, phase.skipped);
          }}
        >
          {phase.request.action === 'close' && <Check size={13} aria-hidden />}
          Confirm
        </button>
        <button type="button" className={button} onClick={back}>
          Cancel
        </button>
      </div>
    );
  } else {
    main = (
      <div className="flex flex-none items-center gap-1.5">
        <div className="hidden items-center gap-1.5 @xs:flex">
          {actions.map((action) => {
            const Icon = ICON[action];
            const count = has ? selected.filter((alert) => appliesTo(action, alert)).length : 0;
            const unavailable = !has || count === 0 || busy;
            return (
              <button
                key={action}
                ref={(element) => {
                  if (element) buttons.current.set(action, element);
                  else buttons.current.delete(action);
                }}
                type="button"
                className={button}
                // aria-disabled, not disabled: the button keeps focus while an action runs and after it.
                aria-disabled={unavailable || undefined}
                tabIndex={has ? 0 : -1}
                aria-label={has ? `${ACTION_LABEL[action]} ${count}` : ACTION_LABEL[action]}
                data-tip={ACTION_LABEL[action]}
                data-tip-always=""
                onClick={() => !unavailable && fromBar(action)}
              >
                <Icon size={13} aria-hidden />
                <span className="hidden @2xl:inline">{ACTION_LABEL[action]}</span>
                {has && <span className="tabular-nums text-muted">{count}</span>}
              </button>
            );
          })}
        </div>
        <button
          ref={moreButton}
          type="button"
          className={iconButton}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuFromButton}
          aria-disabled={!has || undefined}
          tabIndex={has ? 0 : -1}
          data-tip="More actions"
          data-tip-always=""
          onClick={toggleMenu}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !menuFromButton) {
              event.preventDefault();
              toggleMenu();
            }
          }}
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Bulk actions"
      className={cn('@container flex-none border-b', has ? 'border-accent/40 bg-accent-soft' : 'border-line bg-panel')}
    >
      <div className="flex h-9 items-center gap-2 px-3 text-xs">
        <span className={cn('flex flex-none items-center gap-1.5 tabular-nums', has ? 'font-semibold text-fg' : 'text-muted')}>
          <ListChecks size={14} aria-hidden className={has ? 'text-accent' : undefined} />
          <span>
            {selected.length}
            <span className="hidden @xs:inline"> selected</span>
          </span>
        </span>
        {main}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-muted">
          {phase.kind === 'running' && (
            <span className="inline-flex flex-none items-center gap-1.5">
              <Loader2 size={13} aria-hidden className="spin" />
              {ACTION_LABEL[phase.action]}
              <span className="tabular-nums">
                {phase.done} / {phase.total}
              </span>
            </span>
          )}
          <div role="status" className="flex min-w-0 items-center gap-2">
            {shownOutcome && <OutcomeText outcome={shownOutcome} />}
          </div>
          {shownOutcome && shownOutcome.failures.length > 0 && <FailedButton key={shownOutcome.id} failures={shownOutcome.failures} />}
          {shownOutcome && (
            <button
              type="button"
              onClick={() => {
                setOutcome(null);
                focusTable();
              }}
              aria-label="Dismiss"
              data-tip="Dismiss"
              data-tip-always=""
              className="inline-flex size-6 flex-none items-center justify-center rounded text-muted hover:bg-hover hover:text-fg active:bg-line"
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </div>
        {has && phase.kind !== 'running' && (
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: 'idle' });
              onClear();
              focusTable();
            }}
            className={quietButton}
            aria-label="Clear selection"
            data-tip="Clear selection"
            data-tip-always=""
          >
            <X size={13} aria-hidden />
            <span className="hidden @xl:inline">Clear</span>
          </button>
        )}
      </div>
      {contextMenu && (
        <AlertMenu
          key={menuKey}
          menu={contextMenu}
          selected={selected}
          allowed={allowed}
          busy={busy}
          onRun={(request, name, targets, skipped) => void run(request, name, targets, skipped)}
          onOpenAlert={onOpenAlert}
          onClose={onCloseMenu}
        />
      )}
    </div>
  );
}
