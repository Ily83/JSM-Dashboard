import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CircleCheck, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { ACTION_LABEL, BULK_ACTION_IDS, type ActionId, type BulkActionId } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';
import { applyActionResult } from '../../api/hooks';
import { postAction } from '../../api/client';
import { cn } from '../../lib/cn';

/**
 * Bulk acknowledge, unacknowledge and close for the selected alerts.
 *
 * The API acts on one alert per request, so the alerts are sent one by one
 * (three at a time). Alerts the action does not apply to are skipped up
 * front, the count is confirmed before anything is sent, and the outcome is
 * reported per alert.
 */

const CONCURRENCY = 3;

export function appliesTo(action: BulkActionId, alert: Alert): boolean {
  if (alert.status === 'closed') return false;
  if (action === 'acknowledge') return !alert.acknowledged;
  if (action === 'unacknowledge') return alert.acknowledged;
  return true;
}

const ICON = { acknowledge: CheckCheck, unacknowledge: RotateCcw, close: CircleCheck } as const;
const PAST = { acknowledge: 'acknowledged', unacknowledge: 'unacknowledged', close: 'closed' } as const;

interface Failure {
  alert: Alert;
  message: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; action: BulkActionId; targets: Alert[]; skipped: number }
  | { kind: 'running'; action: BulkActionId; total: number; done: number }
  | { kind: 'result'; action: BulkActionId; ok: number; pending: number; failures: Failure[]; skipped: number };

export async function runBulk(
  action: BulkActionId,
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

export function BulkActionBar({
  selected,
  allowed,
  onClear,
}: Readonly<{
  selected: Alert[];
  allowed: ReadonlySet<ActionId>;
  onClear: () => void;
}>) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const actions = BULK_ACTION_IDS.filter((id) => allowed.has(id));
  if (selected.length === 0 && phase.kind !== 'result' && phase.kind !== 'running') return null;

  const start = async (action: BulkActionId, targets: Alert[], skipped: number) => {
    setPhase({ kind: 'running', action, total: targets.length, done: 0 });
    const outcome = await runBulk(
      action,
      targets,
      async (alert) => {
        const response = await postAction(alert.id, { action });
        applyActionResult(queryClient, alert.id, response);
        return response.result.state;
      },
      (done) => setPhase({ kind: 'running', action, total: targets.length, done }),
    );
    setPhase({ kind: 'result', action, skipped, ...outcome });
    if (outcome.failures.length === 0) onClear();
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
                onClick={() => setPhase({ kind: 'confirm', action, targets, skipped: selected.length - targets.length })}
              >
                <Icon size={13} aria-hidden />
                {ACTION_LABEL[action]}
                <span className="tabular-nums text-subtle">{targets.length}</span>
              </button>
            );
          })}
        </>
      );
      break;
    case 'confirm':
      body = (
        <>
          <span className="font-semibold">
            {ACTION_LABEL[phase.action]} {phase.targets.length} alert{phase.targets.length === 1 ? '' : 's'}?
          </span>
          {phase.skipped > 0 && (
            <span className="text-muted" data-tip={`Already ${PAST[phase.action]} or closed`} data-tip-always="">
              {phase.skipped} skipped
            </span>
          )}
          <button type="button" autoFocus className={cn(button, 'border-accent bg-accent text-on-accent hover:bg-accent hover:opacity-90')} onClick={() => void start(phase.action, phase.targets, phase.skipped)}>
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
            else onClear();
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
