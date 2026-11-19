import { useState, type ReactNode } from 'react';
import { ChevronRight, Download, Loader2, Plus, X } from 'lucide-react';
import { NOTE_MAX_LENGTH, TAG_MAX_LENGTH, type AlertAction } from '../../../shared/actions';
import { fetchAttachmentUrl } from '../../api/client';
import { useAttachments, useLogs, useNotes } from '../../api/hooks';
import { formatAbsolute, formatRelative } from '../../lib/format';
import { useNow } from '../../lib/now';
import { TagChip } from '../ui/badges';
import { Linkify } from '../ui/Linkify';

/**
 * Detail panel sections that need their own requests: notes (loaded with
 * the panel), activity log and attachments (loaded when expanded, to keep
 * Jira requests down), and tag editing.
 */

const heading = 'text-[11px] font-semibold uppercase tracking-wide text-muted';

function When({ ms }: { ms: number | null }) {
  const now = useNow();
  if (!ms) return null;
  return (
    <span className="tabular-nums text-subtle" data-tip={formatAbsolute(ms)} data-tip-always="">
      {formatRelative(ms, now)}
    </span>
  );
}

function Loading() {
  return (
    <div className="grid gap-1.5" aria-busy="true">
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  );
}

/** A section whose content is only loaded once it is opened. */
function Collapsible({ title, children }: { title: string; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-line px-4 py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`flex w-full items-center gap-1 ${heading} hover:text-fg`}>
        <ChevronRight size={13} aria-hidden className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {title}
      </button>
      {open && <div className="pt-2">{children(open)}</div>}
    </section>
  );
}

export function NotesSection({ alertId, canAdd, run, busy }: { alertId: string; canAdd: boolean; run: (action: AlertAction) => Promise<boolean>; busy: boolean }) {
  const notes = useNotes(alertId);
  const [draft, setDraft] = useState('');
  const values = notes.data?.values ?? [];

  return (
    <section className="border-t border-line px-4 py-3">
      <h3 className={`pb-1.5 ${heading}`}>
        Notes{values.length > 0 && <span className="ml-1 tabular-nums text-subtle">{values.length}{notes.data?.hasMore ? '+' : ''}</span>}
      </h3>
      {canAdd && (
        <form
          className="mb-2 grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const note = draft.trim();
            if (!note) return;
            void run({ action: 'addNote', note }).then((ok) => ok && setDraft(''));
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
            }}
            maxLength={NOTE_MAX_LENGTH}
            rows={2}
            placeholder="Add a note"
            aria-label="New note"
            className="w-full resize-y rounded-md border border-line-strong bg-panel px-2 py-1.5 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          {draft.trim() && (
            <button type="submit" disabled={busy} className="h-7 justify-self-end rounded-md bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-50" data-tip="Ctrl+Enter" data-tip-always="">
              Add note
            </button>
          )}
        </form>
      )}
      {notes.isPending ? (
        <Loading />
      ) : notes.error ? (
        <p className="text-xs text-warn">{notes.error.message}</p>
      ) : values.length === 0 ? (
        !canAdd && <span className="text-subtle">–</span>
      ) : (
        <ul className="grid gap-2">
          {values.map((note) => (
            <li key={note.id} className="rounded-md bg-raised px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="truncate font-medium text-muted">{note.owner ?? 'Unknown'}</span>
                <span className="ml-auto flex-none">
                  <When ms={note.createdAt} />
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed">
                <Linkify text={note.note} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityList({ alertId }: { alertId: string }) {
  const logs = useLogs(alertId, true);
  if (logs.isPending) return <Loading />;
  if (logs.error) return <p className="text-xs text-warn">{logs.error.message}</p>;
  const values = logs.data.values;
  if (values.length === 0) return <span className="text-subtle">–</span>;
  return (
    <ol className="grid gap-1.5">
      {values.map((entry, i) => (
        <li key={`${entry.time ?? 0}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-xs">
          <span className="break-words">{entry.text}</span>
          <When ms={entry.time} />
          {entry.owner && <span className="col-span-2 text-[11px] text-subtle">{entry.owner}</span>}
        </li>
      ))}
      {logs.data.hasMore && <li className="text-[11px] text-subtle">Older entries in Jira</li>}
    </ol>
  );
}

export function ActivitySection({ alertId }: { alertId: string }) {
  return <Collapsible title="Activity">{() => <ActivityList alertId={alertId} />}</Collapsible>;
}

function AttachmentList({ alertId }: { alertId: string }) {
  const attachments = useAttachments(alertId, true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  if (attachments.isPending) return <Loading />;
  if (attachments.error) return <p className="text-xs text-warn">{attachments.error.message}</p>;
  const values = attachments.data.values;
  if (values.length === 0) return <span className="text-subtle">–</span>;

  const open = async (attachmentId: string) => {
    setError(null);
    setOpening(attachmentId);
    // Opened before the request so pop-up blockers allow it; filled in afterwards.
    const tab = window.open('', '_blank');
    try {
      const { url } = await fetchAttachmentUrl(alertId, attachmentId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <ul className="grid gap-1">
        {values.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-xs">
            <button type="button" onClick={() => void open(a.id)} className="flex min-w-0 items-center gap-1.5 text-accent hover:underline" data-tip="Download" data-tip-always="">
              {opening === a.id ? <Loader2 size={12} aria-hidden className="spin flex-none" /> : <Download size={12} aria-hidden className="flex-none" />}
              <span className="truncate">{a.name}</span>
            </button>
            <span className="ml-auto flex-none">
              <When ms={a.insertedAt} />
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-xs text-crit">{error}</p>}
    </>
  );
}

export function AttachmentsSection({ alertId }: { alertId: string }) {
  return <Collapsible title="Attachments">{() => <AttachmentList alertId={alertId} />}</Collapsible>;
}

/** Tags exactly as Jira stores them, with remove buttons and an add field when allowed. */
export function TagEditor({
  tags,
  canAdd,
  canRemove,
  run,
  busy,
}: {
  tags: string[];
  canAdd: boolean;
  canRemove: boolean;
  run: (action: AlertAction) => Promise<boolean>;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const next = draft
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !tags.includes(t));
    if (next.length === 0) {
      setAdding(false);
      setDraft('');
      return;
    }
    void run({ action: 'addTags', tags: next }).then((ok) => {
      if (ok) {
        setDraft('');
        setAdding(false);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.length === 0 && !canAdd && <span className="text-subtle">–</span>}
      {tags.map((tag) =>
        canRemove ? (
          <span key={tag} className="inline-flex max-w-full items-center">
            <TagChip tag={tag} />
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ action: 'removeTags', tags: [tag] })}
              aria-label={`Remove tag ${tag}`}
              className="-ml-0.5 rounded p-0.5 text-subtle hover:bg-hover hover:text-crit disabled:opacity-50"
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ) : (
          <TagChip key={tag} tag={tag} />
        ),
      )}
      {canAdd &&
        (adding ? (
          <form
            className="inline-flex"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={TAG_MAX_LENGTH * 5}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                  setDraft('');
                }
              }}
              onBlur={() => !draft.trim() && setAdding(false)}
              placeholder="tag, customer:Name"
              aria-label="New tags, separated by commas"
              className="h-6 w-44 rounded border border-line-strong bg-panel px-1.5 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(true)}
            aria-label="Add tags"
            data-tip="Add tags"
            data-tip-always=""
            className="inline-flex h-5 items-center rounded border border-dashed border-line-strong px-1 text-subtle hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Plus size={12} aria-hidden />
          </button>
        ))}
    </div>
  );
}
