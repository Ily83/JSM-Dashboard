import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, Loader2, Plus, X } from 'lucide-react';
import { ATTACHMENT_MAX_BYTES, NOTE_MAX_LENGTH, TAG_MAX_LENGTH, type AlertAction, type AlertNote } from '../../../shared/actions';
import { fetchAttachmentUrl, uploadAttachment } from '../../api/client';
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

function When({ ms }: Readonly<{ ms: number | null }>) {
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
function Collapsible({ title, children }: Readonly<{ title: string; children: (open: boolean) => ReactNode }>) {
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

/** The notes under the add field: loading, error, nothing yet, or the list. */
type NoteControls = { canEdit: boolean; canDelete: boolean; busy: boolean; run: (action: AlertAction) => Promise<boolean> };
const smallButton = 'rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-50';

function NoteRow({ note, busy, canEdit, canDelete, run }: Readonly<NoteControls & { note: AlertNote }>) {
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null);
  const [draft, setDraft] = useState('');
  const submit = (action: AlertAction) => void run(action).then(ok => { if (ok) setMode(null); });
  return <li className="rounded-md bg-raised px-2.5 py-1.5">
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="truncate font-medium text-muted">{note.owner ?? 'Unknown'}</span>
      <span className="ml-auto flex-none"><When ms={note.createdAt} /></span>
      {canEdit && !mode && <button type="button" className={smallButton} disabled={busy} onClick={() => { setDraft(note.note); setMode('edit'); }}>Edit note</button>}
      {canDelete && !mode && <button type="button" className={smallButton} disabled={busy} onClick={() => setMode('delete')}>Delete note</button>}
    </div>
    {mode !== 'edit' && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed"><Linkify text={note.note} /></p>}
    {mode === 'edit' && <form className="mt-1 grid gap-1" onSubmit={e => { e.preventDefault(); submit({ action: 'editNote', noteId: note.id, note: draft.trim() }); }}>
      <textarea className="rounded border border-line-strong bg-panel px-2 py-1 text-xs" aria-label="Edit note text" value={draft} maxLength={NOTE_MAX_LENGTH} onChange={e => setDraft(e.target.value)} />
      <div className="flex gap-1">
        <button className={smallButton} type="submit" disabled={busy || !draft.trim()}>Save note</button>
        <button className={smallButton} type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
      </div>
    </form>}
    {mode === 'delete' && <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      Delete this note permanently?
      <button className={`${smallButton} text-crit`} type="button" disabled={busy} onClick={() => submit({ action: 'deleteNote', noteId: note.id })}>Confirm delete note</button>
      <button className={smallButton} type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
    </div>}
  </li>;
}

function NoteList({ pending, error, values, canAdd, ...controls }: Readonly<NoteControls & { pending: boolean; error: Error | null; values: AlertNote[]; canAdd: boolean }>) {
  if (pending) return <Loading />;
  if (error) return <p className="text-xs text-warn">{error.message}</p>;
  if (values.length === 0) return canAdd ? null : <span className="text-subtle">–</span>;
  return (
    <ul className="grid gap-2">
      {values.map((note) => (
        <NoteRow key={note.id} note={note} {...controls} />
      ))}
    </ul>
  );
}

export function NotesSection({ alertId, canAdd, run, busy, canEdit, canDelete }: Readonly<NoteControls & { alertId: string; canAdd: boolean }>) {
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
      <NoteList pending={notes.isPending} error={notes.error} values={values} canAdd={canAdd} canEdit={canEdit} canDelete={canDelete} busy={busy} run={run} />
    </section>
  );
}

function ActivityList({ alertId }: Readonly<{ alertId: string }>) {
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

export function ActivitySection({ alertId }: Readonly<{ alertId: string }>) {
  return <Collapsible title="Activity">{() => <ActivityList alertId={alertId} />}</Collapsible>;
}

function AttachmentList({ alertId }: Readonly<{ alertId: string }>) {
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
        globalThis.location.assign(url);
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

function AttachmentUpload({ alertId }: Readonly<{ alertId: string }>) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const invalid = file && (!file.size || file.size > ATTACHMENT_MAX_BYTES || file.name.length > 200);
  const upload = useMutation({
    mutationFn: (next: File) => uploadAttachment(alertId, next),
    onSuccess: () => {
      setFile(null);
      setInputKey(key => key + 1);
      void queryClient.invalidateQueries({ queryKey: ['alert-attachments', alertId] });
    },
  });
  return <form className="mb-2 grid gap-1 text-xs" onSubmit={e => {
    e.preventDefault();
    if (file && !invalid && !upload.isPending) upload.mutate(file);
  }}>
    <label className="grid gap-1">File to attach (up to 10 MiB)
      <input type="file" key={inputKey} disabled={upload.isPending} className="w-full" onChange={e => { setFile(e.target.files?.[0] ?? null); upload.reset(); }} />
    </label>
    <button className={`${smallButton} justify-self-start`} disabled={!file || Boolean(invalid) || upload.isPending} type="submit">{upload.isPending ? 'Uploading…' : 'Upload attachment'}</button>
    {invalid && <p role="alert" className="text-crit">Choose a non-empty file up to 10 MiB with a name up to 200 characters.</p>}
    {upload.error && <p role="alert" className="text-crit">{upload.error.message}</p>}
  </form>;
}

export function AttachmentsSection({ alertId, canUpload }: Readonly<{ alertId: string; canUpload: boolean }>) {
  return <Collapsible title="Attachments">{() => <>{canUpload && <AttachmentUpload alertId={alertId} />}<AttachmentList alertId={alertId} /></>}</Collapsible>;
}

/** Tags exactly as Jira stores them, with remove buttons and an add field when allowed. */
export function TagEditor({
  tags,
  canAdd,
  canRemove,
  run,
  busy,
}: Readonly<{
  tags: string[];
  canAdd: boolean;
  canRemove: boolean;
  run: (action: AlertAction) => Promise<boolean>;
  busy: boolean;
}>) {
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
