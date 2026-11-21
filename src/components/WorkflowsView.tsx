import { useMemo, useState } from 'react';
import { PRIORITIES, STATUSES, type Alert } from '../../shared/types';
import { useTeams } from '../api/hooks';
import { randomId } from '../lib/id';
import { deepEqual, useStore } from '../lib/store';
import { jiraChecklist, jiraHome, MAX_DRAFTS, newWorkflow, previewWorkflow, sanitizeDraft, TRIGGERS, WORKFLOW_ACTIONS, WORKFLOW_STATUSES, type WorkflowDraft } from '../lib/workflows';
import { workflowStore } from '../state/workflows';
import { HistoryTable } from './HistoryTable';

const button = 'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50';
const field = 'min-w-0 w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-sm focus:border-accent';
const card = 'min-w-0 space-y-3 rounded-md border border-line bg-panel p-3';
const PREVIEW_ROWS = 30;

function WorkflowEditor({ draft, onChange }: Readonly<{ draft: WorkflowDraft; onChange: (patch: Partial<WorkflowDraft>) => void }>) {
  const teams = useTeams();
  const triggers = (Object.keys(TRIGGERS) as WorkflowDraft['trigger'][]).map(id => <option key={id} value={id}>{TRIGGERS[id]}</option>);
  return <div className="grid gap-3">
    <label className="grid gap-1 text-xs">Workflow name
      <input className={field} required maxLength={80} value={draft.name} onChange={e => onChange({ name: e.target.value })} />
    </label>
    <label className="grid gap-1 text-xs">Trigger
      <select className={field} value={draft.trigger} onChange={e => onChange({ trigger: e.target.value as WorkflowDraft['trigger'] })}>{triggers}</select>
    </label>
    <fieldset className="grid grid-cols-1 gap-2 rounded-md border border-line px-2 pb-2 sm:grid-cols-2">
      <legend className="px-1 text-xs font-semibold">Conditions · match all</legend>
      <label className="grid gap-1 text-xs">Priority
        <select className={field} value={draft.priority} onChange={e => onChange({ priority: e.target.value as WorkflowDraft['priority'] })}>
          <option value="">Any priority</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Status
        <select className={field} value={draft.status} onChange={e => onChange({ status: e.target.value as WorkflowDraft['status'] })}>
          <option value="">Any status</option>{STATUSES.map(s => <option key={s} value={s}>{WORKFLOW_STATUSES[s]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Jira source (exact)
        <input className={field} maxLength={120} value={draft.source} onChange={e => onChange({ source: e.target.value })} placeholder="Any source" />
      </label>
      <label className="grid gap-1 text-xs">Message contains (case-sensitive)
        <input className={field} maxLength={200} value={draft.message} onChange={e => onChange({ message: e.target.value })} />
      </label>
    </fieldset>
    <label className="grid gap-1 text-xs">Team scope
      <select className={field} value={draft.teamId} onChange={e => {
        const team = teams.data?.find(t => t.id === e.target.value);
        onChange({ teamId: e.target.value, teamName: team?.name ?? '' });
      }}>
        <option value="">Global · all teams</option>
        {draft.teamId && !teams.data?.some(t => t.id === draft.teamId) && <option value={draft.teamId}>{draft.teamName || draft.teamId}</option>}
        {teams.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {teams.isError && <span className="text-warn">Could not load Jira teams.</span>}
    </label>
    <label className="grid gap-1 text-xs">Action in Jira
      <select className={field} value={draft.action} onChange={e => onChange({ action: e.target.value as WorkflowDraft['action'] })}>
        {(Object.keys(WORKFLOW_ACTIONS) as WorkflowDraft['action'][]).map(id => <option key={id} value={id}>{WORKFLOW_ACTIONS[id]}</option>)}
      </select>
    </label>
  </div>;
}

function JiraHandoff({ draft, site }: Readonly<{ draft: WorkflowDraft; site: string | null | undefined }>) {
  const [feedback, setFeedback] = useState('');
  const jira = jiraHome(site);
  const checklist = jiraChecklist(draft);
  return <section className={card} aria-labelledby="jira-handoff">
    <h2 className="text-sm font-semibold" id="jira-handoff">Set up in Jira Automation</h2>
    <p className="text-xs text-muted">This checklist is not a Jira import. The dashboard cannot publish or run it. Choose connections and recipients in Jira.</p>
    <textarea readOnly rows={7} aria-label="Jira setup checklist" value={checklist} className={`${field} text-xs`} />
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button type="button" className={button} onClick={async () => {
        try { await navigator.clipboard.writeText(checklist); setFeedback('Checklist copied'); }
        catch { setFeedback('Select and copy the checklist above.'); }
      }}>Copy checklist</button>
      {jira && <a href={jira} target="_blank" rel="noreferrer" className={button}>Open Jira</a>}
      <a href="https://support.atlassian.com/cloud-automation/docs/jira-automation-triggers/" target="_blank" rel="noreferrer" className="text-accent hover:underline">Jira trigger reference</a>
      <output>{feedback}</output>
    </div>
  </section>;
}

export function WorkflowsView({ alerts, site, ready, limited }: Readonly<{
  alerts: Alert[]; site: string | null | undefined; ready: boolean; limited: boolean;
}>) {
  const drafts = useStore(workflowStore);
  const [draft, setDraft] = useState(() => newWorkflow(randomId('workflow')));
  const [feedback, setFeedback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const matches = useMemo(() => previewWorkflow(alerts, draft), [alerts, draft]);
  const saved = drafts.find(d => d.id === draft.id);
  const normalized = sanitizeDraft(draft);
  const canSave = normalized && (saved ? !deepEqual(normalized, saved) : drafts.length < MAX_DRAFTS);
  const show = (next: WorkflowDraft) => { setDraft(next); setFeedback(''); setConfirmDelete(false); };
  const persist = (next: WorkflowDraft[], message: string) => {
    workflowStore.set(next);
    setFeedback(workflowStore.save() ? message : 'Browser storage unavailable. Your change is not saved after reload.');
  };

  return <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
    <p className="text-sm text-muted">Draft and preview an alert workflow. Jira Automation runs it only after an authorized operator configures and enables it in Jira.</p>
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(19rem,2fr)_minmax(0,3fr)]">
      <section className={card} aria-labelledby="workflow-draft">
        <h2 id="workflow-draft" className="text-sm font-semibold">Workflow draft</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-40 flex-1 gap-1 text-xs">Saved drafts
            <select className={field} value={saved?.id ?? ''} onChange={e => show(drafts.find(d => d.id === e.target.value) ?? newWorkflow(randomId('workflow')))}>
              <option value="">Unsaved draft</option>
              {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button type="button" className={button} onClick={() => show(newWorkflow(randomId('workflow')))}>New draft</button>
        </div>
        <form className="space-y-3" onSubmit={e => {
          e.preventDefault();
          if (!normalized || !canSave) return;
          setDraft(normalized);
          persist(saved ? drafts.map(d => d.id === normalized.id ? normalized : d) : [...drafts, normalized], 'Draft saved in this browser.');
        }}>
          <WorkflowEditor draft={draft} onChange={patch => { setDraft(current => ({ ...current, ...patch })); setFeedback(''); }} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={button} disabled={!canSave}>Save draft</button>
            {saved && !confirmDelete && <button type="button" className={button} onClick={() => setConfirmDelete(true)}>Delete draft</button>}
            {confirmDelete && <><span className="text-xs">Delete this local draft?</span>
              <button type="button" className={`${button} text-crit`} onClick={() => {
                show(newWorkflow(randomId('workflow')));
                persist(drafts.filter(d => d.id !== draft.id), 'Draft deleted. Jira rules were not changed.');
              }}>Confirm delete</button>
              <button type="button" className={button} onClick={() => setConfirmDelete(false)}>Cancel</button></>}
          </div>
          {!saved && drafts.length >= MAX_DRAFTS && <p className="text-xs text-warn">Delete an existing draft to save a new one.</p>}
          <output className="text-xs text-muted">{feedback}</output>
        </form>
      </section>
      <div className="grid min-w-0 gap-3">
        <section className={card} aria-labelledby="workflow-preview">
          <h2 className="text-sm font-semibold" id="workflow-preview">Preview matching alerts</h2>
          <p className="text-xs text-muted">Matches current fields in the loaded dashboard list. This does not replay the trigger or send anything. Team scope is approximated using team responders.</p>
          {limited && <p className="text-xs text-warn">The loaded list is limited or stale, so this preview may be incomplete.</p>}
          {ready ? <output className="block text-sm tabular-nums">{matches.length.toLocaleString()} of {alerts.length.toLocaleString()} loaded alerts match
            {matches.length > PREVIEW_ROWS && ` · showing newest ${PREVIEW_ROWS}`}</output> : <p className="text-xs text-muted">No alert list loaded yet.</p>}
          {matches.length > 0 && <div className="max-h-72 overflow-auto"><HistoryTable alerts={matches.slice(0, PREVIEW_ROWS)} /></div>}
        </section>
        <JiraHandoff key={JSON.stringify(draft)} draft={draft} site={site} />
      </div>
    </div>
  </main>;
}
