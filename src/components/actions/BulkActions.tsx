import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CircleCheck, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { ACTION_LABEL, BULK_ACTION_IDS, NOTE_MAX_LENGTH, TAG_MAX_LENGTH, TAGS_MAX_PER_REQUEST, type ActionId, type AlertAction, type BulkActionId } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';
import { applyActionResult, useAlertDetail } from '../../api/hooks';
import { postAction } from '../../api/client';
import { cn } from '../../lib/cn';
import { AssignPicker, EscalatePicker, PriorityPicker, ResponderPicker, SnoozePicker } from './Pickers';

/**
 * The context menu provides enabled alert actions for the selection.
 *
 * The API acts on one alert per request, so the alerts are sent one by one
 * (three at a time). Alerts the action does not apply to are skipped up
 * front, the count is confirmed before anything is sent, and the outcome is
 * reported per alert.
 */

const CONCURRENCY = 3;

type BulkOperation = AlertAction['action'];
type BulkRequest = AlertAction;
type PickerAction = Exclude<BulkOperation, BulkActionId>;
const PICKER_ACTIONS: PickerAction[] = ['assign', 'snooze', 'priority', 'addResponder', 'escalate', 'addTags', 'removeTags', 'addNote', 'customAction'];

export function appliesTo(action: BulkOperation, alert: Alert): boolean {
  if (alert.status === 'closed') return action === 'addNote' || action === 'addTags' || action === 'removeTags';
  if (action === 'acknowledge') return !alert.acknowledged;
  if (action === 'unacknowledge') return alert.acknowledged;
  return true;
}

const ICON = { acknowledge: CheckCheck, unacknowledge: RotateCcw, close: CircleCheck } as const;
const PAST: Record<BulkOperation, string> = {
  acknowledge: 'acknowledged', unacknowledge: 'unacknowledged', close: 'closed', assign: 'assigned',
  snooze: 'snoozed', priority: 'updated', addResponder: 'updated', escalate: 'escalated',
  addTags: 'updated', removeTags: 'updated', addNote: 'updated', customAction: 'updated',
};

interface Failure {
  alert: Alert;
  message: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; request: BulkRequest; detail?: string; targets: Alert[]; skipped: number }
  | { kind: 'running'; action: BulkOperation; total: number; done: number }
  | { kind: 'result'; action: BulkOperation; ok: number; pending: number; failures: Failure[]; skipped: number };

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

const button =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 text-xs font-semibold hover:bg-hover disabled:opacity-50';

export interface AlertContextMenu {
  x: number;
  y: number;
  alertId: string | null;
}

function TextActionPicker({ action, onPick }: Readonly<{ action: 'addNote' | 'addTags' | 'removeTags'; onPick: (request: BulkRequest, detail: string) => void }>) {
  const [text, setText] = useState('');
  const tags = [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))];
  const valid = action === 'addNote'
    ? text.trim().length > 0 && text.trim().length <= NOTE_MAX_LENGTH
    : tags.length > 0 && tags.length <= TAGS_MAX_PER_REQUEST && tags.every((tag) => tag.length <= TAG_MAX_LENGTH);
  return (
    <form className="grid w-64 gap-2 p-2" onSubmit={(event) => {
      event.preventDefault();
      if (!valid) return;
      if (action === 'addNote') {
        const note = text.trim();
        onPick({ action, note }, `: “${note.length > 120 ? `${note.slice(0, 120)}…` : note}”`);
      } else {
        onPick({ action, tags }, `: ${tags.join(', ')}`);
      }
    }}>
      <label className="grid gap-1">
        {action === 'addNote' ? 'Note' : 'Tags (comma-separated)'}
        <textarea autoFocus aria-label={action === 'addNote' ? 'Note' : 'Tags'} rows={3} maxLength={action === 'addNote' ? NOTE_MAX_LENGTH : undefined} value={text} onChange={(event) => setText(event.target.value)} className="w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-fg" />
      </label>
      {action !== 'addNote' && <span className="text-muted">Up to {TAGS_MAX_PER_REQUEST} tags, {TAG_MAX_LENGTH} characters each.</span>}
      <button type="submit" className={button} disabled={!valid}>Continue</button>
    </form>
  );
}

function CustomActionPicker({ alert, onPick }: Readonly<{ alert: Alert; onPick: (request: BulkRequest, detail: string) => void }>) {
  const detail = useAlertDetail(alert.id, alert.updatedAt);
  if (detail.isPending) return <p className="p-2 text-muted">Loading actions…</p>;
  if (detail.error) return <p role="alert" className="p-2 text-crit">{detail.error.message}</p>;
  const actions = detail.data?.actions ?? [];
  return actions.length ? (
    <div className="grid gap-1 p-2">
      {actions.map((actionName) => <button key={actionName} type="button" className="rounded px-2 py-1 text-left hover:bg-hover" onClick={() => onPick({ action: 'customAction', actionName }, `: ${actionName}`)}>{actionName}</button>)}
    </div>
  ) : <p className="p-2 text-muted">No custom actions on this alert.</p>;
}

function ContextMenu({
  menu, selected, allowed, busy, onAction, onOpenAlert, onClose,
}: Readonly<{
  menu: AlertContextMenu;
  selected: Alert[];
  allowed: ReadonlySet<ActionId>;
  busy: boolean;
  onAction: (request: BulkRequest, detail?: string) => void;
  onOpenAlert: (id: string) => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<PickerAction | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = 0;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - rect.width))}px`;
    element.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - rect.height))}px`;
    if (!picker) element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu, picker]);
  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [onClose]);

  const picked = (request: BulkRequest, detail?: string) => { onAction(request, detail); onClose(); };
  const first = selected[0];
  return createPortal(
    <div ref={ref} role="dialog" aria-label="Alert actions" className="fixed z-50 max-h-[80vh] min-w-48 overflow-y-auto rounded-md border border-line-strong bg-panel p-1 text-xs shadow-pop" style={{ left: menu.x, top: menu.y }}>
      <div className="px-2 py-1.5 font-semibold text-muted">{selected.length} selected</div>
      {picker && first ? (
        <>
          <button type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover" onClick={() => setPicker(null)}>Back</button>
          {picker === 'assign' && <AssignPicker onPick={(accountId, name) => picked({ action: 'assign', accountId }, ` to ${name}`)} />}
          {picker === 'snooze' && <SnoozePicker onPick={(endTime) => picked({ action: 'snooze', endTime }, ` until ${new Date(endTime).toLocaleString()}`)} />}
          {picker === 'priority' && <PriorityPicker onPick={(priority) => picked({ action: 'priority', priority }, ` to ${priority}`)} />}
          {(picker === 'addResponder' || picker === 'escalate') && selected.length > 1 && <p className="px-2 text-muted">Choices are based on the first selected alert; Jira may reject other alerts.</p>}
          {picker === 'addResponder' && <ResponderPicker alert={first} onPick={(responder, name) => picked({ action: 'addResponder', responder }, `: ${name}`)} />}
          {picker === 'escalate' && <EscalatePicker alert={first} onPick={(escalationId, name) => picked({ action: 'escalate', escalationId }, `: ${name}`)} />}
          {(picker === 'addNote' || picker === 'addTags' || picker === 'removeTags') && <TextActionPicker action={picker} onPick={picked} />}
          {picker === 'customAction' && <CustomActionPicker alert={first} onPick={picked} />}
        </>
      ) : (
        <>
          {menu.alertId && (
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover" onClick={() => { onOpenAlert(menu.alertId!); onClose(); }}>
              Open alert details
            </button>
          )}
          {BULK_ACTION_IDS.map((action) => {
            const count = selected.filter((alert) => appliesTo(action, alert)).length;
            return (
              <button key={action} type="button" disabled={!allowed.has(action) || busy || count === 0} className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover disabled:opacity-50" onClick={() => picked({ action })}>
                {ACTION_LABEL[action]} ({count})
              </button>
            );
          })}
          {PICKER_ACTIONS.map((action) => (
            <button key={action} type="button" disabled={!allowed.has(action) || busy || !selected.some((alert) => appliesTo(action, alert)) || (action === 'customAction' && selected.length !== 1)} title={action === 'customAction' && selected.length !== 1 ? 'Custom actions are specific to one alert.' : undefined} className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover disabled:opacity-50" onClick={() => setPicker(action)}>
              {ACTION_LABEL[action]}…
            </button>
          ))}
          {[...BULK_ACTION_IDS, ...PICKER_ACTIONS].some((action) => !allowed.has(action)) && <div className="px-2 py-1.5 text-muted">Disabled actions must be enabled in the backend.</div>}
        </>
      )}
    </div>,
    document.body,
  );
}

export function BulkActionBar({
  selected,
  allowed,
  onClear,
  contextMenu,
  onCloseMenu,
  onOpenAlert,
}: Readonly<{
  selected: Alert[];
  allowed: ReadonlySet<ActionId>;
  onClear: () => void;
  contextMenu: AlertContextMenu | null;
  onCloseMenu: () => void;
  onOpenAlert: (id: string) => void;
}>) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const selectionKey = selected.map((alert) => alert.id).sort().join('\0');
  const previousSelection = useRef(selectionKey);
  useEffect(() => {
    if (previousSelection.current !== selectionKey) {
      previousSelection.current = selectionKey;
      setPhase((current) => current.kind === 'confirm' ? { kind: 'idle' } : current);
    }
  }, [selectionKey]);
  useEffect(() => {
    if (selected.length === 0 && contextMenu) onCloseMenu();
  }, [selected.length, contextMenu, onCloseMenu]);
  const actions = BULK_ACTION_IDS.filter((id) => allowed.has(id));
  if (selected.length === 0 && phase.kind !== 'result' && phase.kind !== 'running') return null;

  const confirm = (request: BulkRequest, detail?: string) => {
    const targets = selected.filter((alert) => appliesTo(request.action, alert));
    if (targets.length > 0) setPhase({ kind: 'confirm', request, detail, targets, skipped: selected.length - targets.length });
  };

  const start = async ({ request, targets, skipped }: Extract<Phase, { kind: 'confirm' }>) => {
    const action = request.action;
    const startedWith = selectionKey;
    setPhase({ kind: 'running', action, total: targets.length, done: 0 });
    const outcome = await runBulk(
      action,
      targets,
      async (alert) => {
        const response = await postAction(alert.id, request);
        applyActionResult(queryClient, alert.id, response);
        return response.result.state;
      },
      (done) => setPhase({ kind: 'running', action, total: targets.length, done }),
    );
    setPhase({ kind: 'result', action, skipped, ...outcome });
    if (outcome.failures.length === 0 && previousSelection.current === startedWith) onClear();
  };

  let body: React.ReactNode;
  switch (phase.kind) {
    case 'idle':
      body = (
        <>
          {actions.map((action) => {
            const Icon = ICON[action];
            const targets = selected.filter((a) => appliesTo(action, a));
            return (
              <button
                key={action}
                type="button"
                className={button}
                disabled={targets.length === 0}
                onClick={() => confirm({ action })}
              >
                <Icon size={13} aria-hidden />
                {ACTION_LABEL[action]}
                <span className="tabular-nums text-subtle">{targets.length}</span>
              </button>
            );
          })}
          {actions.length === 0 && <span className="text-muted">{PICKER_ACTIONS.some((action) => allowed.has(action)) ? 'Actions are available from the alert menu.' : 'Bulk actions are disabled.'}</span>}
        </>
      );
      break;
    case 'confirm':
      body = (
        <>
          <span className="font-semibold">
            {ACTION_LABEL[phase.request.action]} {phase.targets.length} alert{phase.targets.length === 1 ? '' : 's'}{phase.detail ?? ''}?
          </span>
          {phase.targets.length > 1 && (phase.request.action === 'addResponder' || phase.request.action === 'escalate') && (
            <span className="text-muted">Jira may reject this target for some alerts.</span>
          )}
          {phase.skipped > 0 && (
            <span className="text-muted" data-tip="Not applicable or closed" data-tip-always="">
              {phase.skipped} skipped
            </span>
          )}
          <button type="button" autoFocus className={cn(button, 'border-accent bg-accent text-on-accent hover:bg-accent hover:opacity-90')} onClick={() => void start(phase)}>
            Confirm
          </button>
          <button type="button" className={button} onClick={() => setPhase({ kind: 'idle' })}>
            Cancel
          </button>
        </>
      );
      break;
    case 'running':
      body = (
        <output className="inline-flex items-center gap-1.5 text-muted">
          <Loader2 size={13} aria-hidden className="spin" />
          {ACTION_LABEL[phase.action]}: <span className="tabular-nums">{phase.done} / {phase.total}</span>
        </output>
      );
      break;
    case 'result':
      body = (
        <div className="flex min-w-0 flex-1 flex-col gap-1" role={phase.failures.length > 0 ? 'alert' : 'status'}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-ok">
              {phase.ok} {PAST[phase.action]}
            </span>
            {phase.pending > 0 && <span className="text-warn" data-tip="Sent, not confirmed by Jira yet" data-tip-always="">{phase.pending} pending</span>}
            {phase.failures.length > 0 && <span className="font-semibold text-crit">{phase.failures.length} failed</span>}
            {phase.skipped > 0 && <span className="text-muted">{phase.skipped} skipped</span>}
          </div>
          {phase.failures.length > 0 && (
            <ul className="max-h-24 overflow-y-auto text-[11px]">
              {phase.failures.map((f) => (
                <li key={f.alert.id} className="flex gap-1.5">
                  <TriangleAlert size={11} aria-hidden className="mt-0.5 flex-none text-crit" />
                  <span className="flex-none font-mono">{f.alert.tinyId ? `#${f.alert.tinyId}` : f.alert.id.slice(0, 8)}</span>
                  <span className="min-w-0 truncate text-muted" data-tip={`${f.alert.summary}\n${f.message}`}>
                    {f.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
      break;
  }

  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-accent/40 bg-accent-soft px-3 py-1.5 text-xs" aria-label="Bulk actions">
      {contextMenu && (
        <ContextMenu menu={contextMenu} selected={selected} allowed={allowed} busy={phase.kind !== 'idle'} onAction={confirm} onOpenAlert={onOpenAlert} onClose={onCloseMenu} />
      )}
      {phase.kind !== 'result' && (
        <span className="font-semibold tabular-nums">{selected.length} selected</span>
      )}
      {body}
      <span className="ml-auto" />
      {phase.kind !== 'running' && (
        <button
          type="button"
          onClick={() => {
            if (phase.kind === 'result') setPhase({ kind: 'idle' });
            else {
              setPhase({ kind: 'idle' });
              onClear();
            }
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-fg"
          aria-label={phase.kind === 'result' ? 'Dismiss' : 'Clear selection'}
        >
          <X size={13} aria-hidden />
          {phase.kind === 'result' ? 'Dismiss' : 'Clear'}
        </button>
      )}
    </div>
  );
}
