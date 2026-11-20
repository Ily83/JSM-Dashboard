import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { BellOff, Check, CheckCheck, CircleCheck, Ellipsis, Loader2, Play, RotateCcw, TriangleAlert, UserPlus, X } from 'lucide-react';
import type { ActionId, AlertAction } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { Popover } from '../ui/Popover';
import { AssignPicker, EscalatePicker, PriorityPicker, ResponderPicker, SnoozePicker } from './Pickers';
import type { RunState } from './useActionRunner';

/**
 * Write actions for the alert in the detail panel. Only actions enabled on
 * the backend are shown; actions Jira refuses on a closed alert are
 * disabled. Close asks for a second click.
 */

const button =
  'inline-flex h-7 flex-none items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2 text-xs font-semibold text-fg hover:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-panel';
const iconButton =
  'inline-flex size-7 flex-none items-center justify-center rounded-md border border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg disabled:opacity-50';
const menuItem = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover disabled:opacity-50';

type TriggerRender = ComponentProps<typeof Popover>['trigger'];

/** Pop-over trigger: an icon button whose label is also its tooltip. */
function iconTrigger(label: string, icon: ReactNode, disabled: boolean): TriggerRender {
  return (props) => (
    <button type="button" {...props} className={iconButton} disabled={disabled} aria-label={label} data-tip={label} data-tip-always="">
      {icon}
    </button>
  );
}

interface AlertActionsProps {
  alert: Alert;
  allowed: ReadonlySet<ActionId>;
  run: (action: AlertAction) => Promise<boolean>;
  busy: boolean;
  /** The alert's own custom actions, from its detail. */
  customActions: string[];
}

type Submenu = 'responder' | 'escalate' | 'priority' | { custom: string } | null;

/** True while the user types somewhere: single-key shortcuts must not fire. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="dialog"]') !== null;
}

export function AlertActions({ alert, allowed, run, busy, customActions }: Readonly<AlertActionsProps>) {
  const closed = alert.status === 'closed';
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    if (!confirmClose) return;
    const timer = setTimeout(() => setConfirmClose(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClose]);

  const can = (id: ActionId) => allowed.has(id);
  const custom = can('customAction') ? customActions : [];
  const more = (['addResponder', 'escalate', 'priority'] as const).filter(can);
  const [submenu, setSubmenu] = useState<Submenu>(null);

  // Single-key shortcuts for the alert in the panel: A acknowledge,
  // U unacknowledge, C close (then Enter or C again to confirm).
  const latest = useRef({ alert, busy, closed, confirmClose, can, run });
  latest.current = { alert, busy, closed, confirmClose, can, run };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc cancels a pending close before it closes the panel.
      if (event.key === 'Escape' && latest.current.confirmClose && !event.defaultPrevented) {
        event.preventDefault();
        setConfirmClose(false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || typingIn(event.target)) return;
      const { alert: a, busy: b, closed: isClosed, confirmClose: confirming, can: allowedNow, run: send } = latest.current;
      if (b) return;
      const key = event.key.toLowerCase();
      if (key === 'a' && allowedNow('acknowledge') && !isClosed && !a.acknowledged) {
        event.preventDefault();
        void send({ action: 'acknowledge' });
      } else if (key === 'u' && allowedNow('unacknowledge') && !isClosed && a.acknowledged) {
        event.preventDefault();
        void send({ action: 'unacknowledge' });
      } else if (key === 'c' && allowedNow('close') && !isClosed) {
        event.preventDefault();
        if (confirming) {
          setConfirmClose(false);
          void send({ action: 'close' });
        } else {
          setConfirmClose(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {alert.acknowledged && !closed
        ? can('unacknowledge') && (
            <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'unacknowledge' })} data-tip="Back to open (shown as Open in Jira) · U" data-tip-always="">
              <RotateCcw size={13} aria-hidden />
              Unacknowledge
            </button>
          )
        : can('acknowledge') && (
            <button type="button" className={button} disabled={busy || closed} onClick={() => void run({ action: 'acknowledge' })} data-tip="A" data-tip-always="">
              <CheckCheck size={13} aria-hidden className="text-info" />
              Acknowledge
            </button>
          )}

      {can('close') &&
        (confirmClose ? (
          <span className="inline-flex flex-none items-center gap-0.5">
            <button
              type="button"
              className={cn(button, 'border-ok bg-ok-soft text-ok hover:bg-ok-soft')}
              disabled={busy}
              autoFocus
              onClick={() => {
                setConfirmClose(false);
                void run({ action: 'close' });
              }}
            >
              <Check size={13} aria-hidden />
              Confirm close
            </button>
            <button type="button" className={iconButton} aria-label="Cancel" onClick={() => setConfirmClose(false)}>
              <X size={13} aria-hidden />
            </button>
          </span>
        ) : (
          <button type="button" className={button} disabled={busy || closed} onClick={() => setConfirmClose(true)} data-tip="C" data-tip-always="">
            <CircleCheck size={13} aria-hidden className="text-ok" />
            Close
          </button>
        ))}

      {can('snooze') && (
        <Popover
          label="Snooze"
          trigger={iconTrigger('Snooze', <BellOff size={14} aria-hidden />, busy || closed)}
        >
          {(close) => (
            <SnoozePicker
              onPick={(endTime) => {
                close();
                void run({ action: 'snooze', endTime });
              }}
            />
          )}
        </Popover>
      )}

      {can('assign') && (
        <Popover
          label="Assign"
          trigger={iconTrigger('Assign', <UserPlus size={14} aria-hidden />, busy || closed)}
        >
          {(close) => (
            <AssignPicker
              onPick={(accountId) => {
                close();
                void run({ action: 'assign', accountId });
              }}
            />
          )}
        </Popover>
      )}

      {(more.length > 0 || custom.length > 0) && (
        <Popover
          label="More actions"
          align="end"
          onOpenChange={(open) => !open && setSubmenu(null)}
          trigger={iconTrigger('More actions', <Ellipsis size={14} aria-hidden />, busy || closed)}
        >
          {(close) => {
            const done = (action: AlertAction) => {
              close();
              setSubmenu(null);
              void run(action);
            };
            if (submenu === 'responder') return <ResponderPicker alert={alert} onPick={(responder) => done({ action: 'addResponder', responder })} />;
            if (submenu === 'escalate') return <EscalatePicker alert={alert} onPick={(escalationId) => done({ action: 'escalate', escalationId })} />;
            if (submenu === 'priority') return <PriorityPicker current={alert.priority} onPick={(priority) => done({ action: 'priority', priority })} />;
            if (submenu && typeof submenu === 'object') {
              return (
                <div className="grid w-56 gap-2 p-2">
                  <span className="break-words text-xs font-semibold">Run “{submenu.custom}”?</span>
                  <div className="flex gap-1">
                    <button type="button" autoFocus className={cn(button, 'border-accent bg-accent text-on-accent hover:bg-accent hover:opacity-90')} onClick={() => done({ action: 'customAction', actionName: submenu.custom })}>
                      <Play size={12} aria-hidden />
                      Run
                    </button>
                    <button type="button" className={button} onClick={() => setSubmenu(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="w-52 p-1">
                {can('addResponder') && (
                  <button type="button" className={menuItem} onClick={() => setSubmenu('responder')}>
                    Add responder…
                  </button>
                )}
                {can('escalate') && (
                  <button type="button" className={menuItem} onClick={() => setSubmenu('escalate')}>
                    Escalate to next…
                  </button>
                )}
                {can('priority') && (
                  <button type="button" className={menuItem} onClick={() => setSubmenu('priority')}>
                    Change priority…
                  </button>
                )}
                {custom.length > 0 && (
                  <>
                    {more.length > 0 && <div className="my-1 border-t border-line" />}
                    {custom.map((name) => (
                      <button key={name} type="button" className={menuItem} onClick={() => setSubmenu({ custom: name })}>
                        <Play size={12} aria-hidden className="flex-none text-muted" />
                        <span className="truncate">{name}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            );
          }}
        </Popover>
      )}
    </>
  );
}

/** One line under the buttons: what is running, what happened. */
export function ActionFeedback({ state, onDismiss }: Readonly<{ state: RunState; onDismiss: () => void }>) {
  if (state.kind === 'idle') return null;
  let icon: ReactNode;
  let text: string;
  let tone: string;
  switch (state.kind) {
    case 'busy':
      icon = <Loader2 size={13} aria-hidden className="spin" />;
      text = `${state.label}…`;
      tone = 'text-muted';
      break;
    case 'done':
      icon = <Check size={13} aria-hidden />;
      text = state.message ?? `${state.label}: done`;
      tone = 'text-ok';
      break;
    case 'pending':
      icon = <Loader2 size={13} aria-hidden />;
      text = `${state.label}: sent, not confirmed by Jira yet`;
      tone = 'text-warn';
      break;
    case 'error':
      icon = <TriangleAlert size={13} aria-hidden />;
      text = state.message;
      tone = 'text-crit';
      break;
  }
  return (
    <div role={state.kind === 'error' ? 'alert' : 'status'} className={cn('mt-2 flex items-start gap-1.5 text-xs', tone)}>
      <span className="mt-px flex-none">{icon}</span>
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {state.kind !== 'busy' && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="flex-none rounded p-0.5 text-subtle hover:bg-hover hover:text-fg">
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
