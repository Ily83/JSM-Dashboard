import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import type { Alert, AlertDetail } from '../../shared/types';
import { useAlertDetail } from '../api/hooks';
import { formatAbsolute, formatRelative } from '../lib/format';
import { useNow } from '../lib/now';
import { CustomerBadge, PriorityBadge, StatusBadge, TagChip } from './ui/badges';

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
  // Prefer the list row for fields both have: it is refreshed by every poll.
  const base: Alert | null = alert ?? detail ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const properties = detail ? Object.entries(detail.extraProperties) : [];
  const loading = detailQuery.isPending;

  return (
    <aside aria-label="Alert details" className="detail-panel">
      <header className="flex-none px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={base.priority} />
          <StatusBadge status={base.status} />
          {base.tinyId && <span className="font-mono text-xs text-subtle">#{base.tinyId}</span>}
          <span className="ml-auto" />
          {closeButton}
        </div>
        <h2 className="mt-2 break-words text-[15px] font-semibold leading-snug">{base.summary}</h2>
        <div className="mt-3 flex items-center gap-2">
          {base.url ? (
            <a
              href={base.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:opacity-90"
            >
              <ExternalLink size={13} aria-hidden />
              Open in Jira
            </a>
          ) : (
            <button
              type="button"
              disabled
              data-tip="Not available in demo mode"
              data-tip-always=""
              className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-3 text-xs font-semibold text-subtle"
            >
              <ExternalLink size={13} aria-hidden />
              Open in Jira
            </button>
          )}
        </div>
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
                responders.map((r) => r.name ?? `${r.type} ${r.id.slice(0, 8)}`).join(', ')
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
          {(detail?.rawTags ?? base.tags).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {(detail?.rawTags ?? base.tags).map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          ) : (
            <span className="text-subtle">–</span>
          )}
        </Section>

        <Section title="Description">
          {loading ? (
            <div className="grid gap-1.5" aria-busy="true">
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-11/12" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ) : detail?.description ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{detail.description}</p>
          ) : (
            <span className="text-subtle">{detailQuery.error ? detailQuery.error.message : '–'}</span>
          )}
          {detail?.detailError && <p className="mt-2 text-xs text-warn">{detail.detailError}</p>}
        </Section>

        <Section title="Additional properties">
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3">
            {properties.map(([key, value]) => (
              <Field key={key} label={key}>
                {value}
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
      </div>
    </aside>
  );
}
