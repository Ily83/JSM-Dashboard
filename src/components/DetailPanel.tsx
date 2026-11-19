import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Check, Copy, ExternalLink, Star, X } from 'lucide-react';
import type { Alert, AlertDetail } from '../../shared/types';
import { useAlertDetail, useMe, useWriteActions } from '../api/hooks';
import { formatAbsolute, formatRelative } from '../lib/format';
import { useNow } from '../lib/now';
import { useStore } from '../lib/store';
import { prefsStore, toggleWatch } from '../state/prefs';
import { ActionFeedback, AlertActions, typingIn } from './actions/AlertActions';
import { ActivitySection, AttachmentsSection, NotesSection, TagEditor } from './actions/AlertExtras';
import { useActionRunner } from './actions/useActionRunner';
import { MaintenanceBadge } from './dashboard/opsWidgets';
import { CustomerBadge, PriorityBadge, StatusBadge } from './ui/badges';
import { findRunbook, Linkify } from './ui/Linkify';

interface DetailPanelProps {
  /** Row data, shown immediately while the full detail loads. Null when the alert is not in the list. */
  alert: Alert | null;
  alertId: string;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="py-1 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 break-words py-1">{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <h3 className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Time({ ms }: { ms: number | null }) {
  const now = useNow();
  if (!ms) return <span className="text-subtle">–</span>;
  return (
    <span className="tabular-nums">
      {formatAbsolute(ms)} <span className="text-subtle">· {formatRelative(ms, now)}</span>
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={copied ? 'Copied' : label}
      data-tip-always=""
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className="rounded p-1 text-subtle hover:bg-hover hover:text-fg"
    >
      {copied ? <Check size={13} aria-hidden className="text-ok" /> : <Copy size={13} aria-hidden />}
    </button>
  );
}

export function DetailPanel({ alert, alertId, onClose }: DetailPanelProps) {
  const detailQuery = useAlertDetail(alertId, alert?.updatedAt);
  const detail: AlertDetail | undefined = detailQuery.data;
  const allowed = useWriteActions();
  const runner = useActionRunner(alertId);
  // Jira returns responders as ids; the account behind the token can at least be named.
  const me = useMe(allowed.size > 0).data;
  // Prefer the list row for fields both have: it is refreshed by every poll.
  const base: Alert | null = alert ?? detail ?? null;
  const watched = useStore(prefsStore).watchList.includes(alertId);
  const runbook = detail ? findRunbook(detail.extraProperties, detail.description) : null;
  const panelRef = useRef<HTMLElement>(null);
  const url = base?.url ?? null;

  // Esc closes. W watches, O opens in Jira, N jumps to the note field
  // (the action keys A, U and C live in AlertActions).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || typingIn(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'w') {
        event.preventDefault();
        toggleWatch(alertId);
      } else if (key === 'o' && url) {
        event.preventDefault();
        window.open(url, '_blank', 'noopener,noreferrer');
      } else if (key === 'n') {
        const field = panelRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]');
        if (field) {
          event.preventDefault();
          field.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, alertId, url]);

  const closeButton = (
    <button type="button" onClick={onClose} aria-label="Close details" className="flex-none rounded p-1 text-muted hover:bg-hover hover:text-fg">
      <X size={16} aria-hidden />
    </button>
  );

  if (!base) {
    return (
      <aside aria-label="Alert details" className="detail-panel">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted">
            {detailQuery.isPending ? 'Loading alert…' : (detailQuery.error?.message ?? 'Alert not found.')}
          </span>
          {closeButton}
        </div>
      </aside>
    );
  }

  const responders = base.responders;
  // With the action buttons in the same row, the link gets a shorter label.
  const alertActionsOn = [...allowed].some((id) => id !== 'maintenance');
  const compact = alertActionsOn;
  const properties = detail ? Object.entries(detail.extraProperties) : [];
  const loading = detailQuery.isPending;

  return (
    <aside ref={panelRef} aria-label="Alert details" className="detail-panel">
      <header className="flex-none px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={base.priority} />
          <StatusBadge status={base.status} />
          {base.tinyId && <span className="font-mono text-xs text-subtle">#{base.tinyId}</span>}
          <MaintenanceBadge integrationName={base.integrationName} />
          <span className="ml-auto" />
          {runbook && (
            <a
              href={runbook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open runbook"
              data-tip="Runbook"
              data-tip-always=""
              className="flex-none rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              <BookOpen size={15} aria-hidden />
            </a>
          )}
          <button
            type="button"
            onClick={() => toggleWatch(base.id)}
            aria-pressed={watched}
            aria-label={watched ? 'Stop watching' : 'Watch'}
            data-tip={watched ? 'Watching · W' : 'Watch · W'}
            data-tip-always=""
            className={watched ? 'flex-none rounded p-1 text-warn hover:bg-hover' : 'flex-none rounded p-1 text-muted hover:bg-hover hover:text-fg'}
          >
            <Star size={15} aria-hidden fill={watched ? 'currentColor' : 'none'} />
          </button>
          {closeButton}
        </div>
        <h2 className="mt-2 break-words text-[15px] font-semibold leading-snug">{base.summary}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {base.url ? (
            <a
              href={base.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Jira"
              data-tip="Open in Jira · O"
              data-tip-always=""
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-semibold text-on-accent hover:opacity-90"
            >
              <ExternalLink size={13} aria-hidden />
              {compact ? 'Jira' : 'Open in Jira'}
            </a>
          ) : (
            <button
              type="button"
              disabled
              data-tip="Not available in demo mode"
              data-tip-always=""
              aria-label="Open in Jira"
              className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs font-semibold text-subtle"
            >
              <ExternalLink size={13} aria-hidden />
              {compact ? 'Jira' : 'Open in Jira'}
            </button>
          )}
          {alertActionsOn && <AlertActions alert={base} allowed={allowed} run={runner.run} busy={runner.busy} customActions={detail?.actions ?? []} />}
        </div>
        <ActionFeedback state={runner.state} onDismiss={runner.dismiss} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Affected customers">
          {base.customers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {base.customers.map((customer) => (
                <CustomerBadge key={customer} name={customer} className="!text-[13px] !leading-[22px]" />
              ))}
            </div>
          ) : (
            <span className="text-subtle">None identified</span>
          )}
        </Section>

        <Section title="Details">
          <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3">
            <Field label="Service">{base.service ?? <span className="text-subtle">–</span>}</Field>
            <Field label="Assignee">{base.assignee ?? <span className="font-medium text-warn">Unassigned</span>}</Field>
            <Field label="Responders">
              {responders.length > 0 ? (
                responders.map((r) => r.name ?? (r.type === 'user' && r.id === me?.accountId ? me.displayName : `${r.type} ${r.id.slice(0, 8)}`)).join(', ')
              ) : (
                <span className="text-subtle">–</span>
              )}
            </Field>
            <Field label="Source">
              {base.source}
              {base.rawSource && base.rawSource !== base.source && <span className="text-subtle"> · {base.rawSource}</span>}
            </Field>
            <Field label="Created">
              <Time ms={base.createdAt} />
            </Field>
            <Field label="Updated">
              <Time ms={base.updatedAt} />
            </Field>
            {base.lastOccurredAt && (
              <Field label="Last occurred">
                <Time ms={base.lastOccurredAt} />
              </Field>
            )}
            {base.ackTime && (
              <Field label="Acknowledged">
                <Time ms={base.ackTime} />
              </Field>
            )}
            {base.closeTime && (
              <Field label="Closed">
                <Time ms={base.closeTime} />
              </Field>
            )}
            {base.snoozedUntil && (
              <Field label="Snoozed until">
                <Time ms={base.snoozedUntil} />
              </Field>
            )}
            <Field label="Occurrences">{base.count}</Field>
          </dl>
        </Section>

        <Section title="Tags">
          <TagEditor
            tags={detail?.rawTags ?? base.tags}
            canAdd={allowed.has('addTags')}
            canRemove={allowed.has('removeTags')}
            run={runner.run}
            busy={runner.busy}
          />
        </Section>

        <Section title="Description">
          {loading ? (
            <div className="grid gap-1.5" aria-busy="true">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-11/12" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ) : detail?.description ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">
              <Linkify text={detail.description} />
            </p>
          ) : (
            <span className="text-subtle">{detailQuery.error ? detailQuery.error.message : '–'}</span>
          )}
          {detail?.detailError && <p className="mt-2 text-xs text-warn">{detail.detailError}</p>}
        </Section>

        <NotesSection alertId={alertId} canAdd={allowed.has('addNote')} run={runner.run} busy={runner.busy} />

        <Section title="Additional properties">
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3">
            {properties.map(([key, value]) => (
              <Field key={key} label={key}>
                <Linkify text={value} />
              </Field>
            ))}
            {base.entity && <Field label="Entity">{base.entity}</Field>}
            {base.alias && <Field label="Alias">{base.alias}</Field>}
            {base.integrationType && <Field label="Integration type">{base.integrationType}</Field>}
            {detail && detail.actions.length > 0 && <Field label="Actions">{detail.actions.join(', ')}</Field>}
            <Field label="Alert ID">
              <span className="flex items-center gap-1">
                <span className="truncate font-mono text-xs">{base.id}</span>
                <CopyButton value={base.id} label="Copy alert ID" />
              </span>
            </Field>
          </dl>
          {loading && <div className="skeleton mt-1 h-3 w-1/2" aria-busy="true" />}
        </Section>

        <ActivitySection alertId={alertId} />
        <AttachmentsSection alertId={alertId} />
      </div>
    </aside>
  );
}
