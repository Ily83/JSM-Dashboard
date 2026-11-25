import { PRIORITIES, STATUSES, type Alert, type AlertStatus, type Priority } from '../../shared/types';
import { isRecord } from './store';

export const TRIGGERS = { created: 'Alert created', updated: 'Alert updated', statusChanged: 'Alert status changed' } as const;
export const WORKFLOW_ACTIONS = { log: 'Log action', slack: 'Send Slack message', email: 'Send email' } as const;
export const WORKFLOW_STATUSES: Record<AlertStatus, string> = { open: 'Open', acked: 'Acknowledged', snoozed: 'Snoozed', closed: 'Closed' };
const JIRA_STATUS: Record<AlertStatus, string> = { open: 'open', acked: 'acknowledged', snoozed: 'snoozed', closed: 'closed' };
export const MAX_DRAFTS = 50;

export interface WorkflowDraft {
  id: string;
  name: string;
  trigger: keyof typeof TRIGGERS;
  priority: Priority | '';
  status: AlertStatus | '';
  teamId: string;
  teamName: string;
  source: string;
  message: string;
  action: keyof typeof WORKFLOW_ACTIONS;
}

export function newWorkflow(id: string): WorkflowDraft {
  return { id, name: '', trigger: 'created', priority: 'P1', status: '', teamId: '', teamName: '', source: '', message: '', action: 'log' };
}

export function sanitizeDraft(value: unknown): WorkflowDraft | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)) return null;
  const text = (key: string, max: number) => typeof value[key] === 'string' ? value[key].trim().slice(0, max) : '';
  const trigger = (Object.keys(TRIGGERS) as WorkflowDraft['trigger'][]).find(key => key === value.trigger);
  const action = (Object.keys(WORKFLOW_ACTIONS) as WorkflowDraft['action'][]).find(key => key === value.action);
  const name = text('name', 80);
  if (!trigger || !action || !name) return null;
  if (typeof value.teamId !== 'string' || !/^[A-Za-z0-9:._-]{0,128}$/.test(value.teamId)) return null;
  const teamId = value.teamId;
  const priority = PRIORITIES.find(p => p === value.priority);
  const status = STATUSES.find(s => s === value.status);
  if ((!priority && value.priority !== '') || (!status && value.status !== '')) return null;
  return {
    id: value.id, name, trigger, action, teamId, teamName: teamId ? text('teamName', 160) : '',
    priority: priority ?? '', status: status ?? '',
    source: text('source', 120), message: text('message', 200),
  };
}

export function sanitizeWorkflows(value: unknown): WorkflowDraft[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, WorkflowDraft>();
  for (const v of value) {
    const draft = sanitizeDraft(v);
    if (draft && !result.has(draft.id)) result.set(draft.id, draft);
    if (result.size >= MAX_DRAFTS) break;
  }
  return [...result.values()];
}

/** Matches current alert fields only, not whether any trigger would have run. */
export function previewWorkflow(alerts: readonly Alert[], draft: WorkflowDraft): Alert[] {
  const source = draft.source.trim();
  const message = draft.message.trim();
  return alerts.filter(alert => (!draft.priority || draft.priority === alert.priority) &&
    (!draft.status || draft.status === alert.status) &&
    (!draft.teamId || alert.responders.some(r => r.type === 'team' && r.id === draft.teamId)) &&
    (!source || source === alert.rawSource) &&
    (!message || alert.summary.includes(message)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function jiraChecklist(draft: WorkflowDraft): string {
  const steps = [
    draft.teamId ? `Open ${draft.teamName || draft.teamId} → Operations → Automation.` : 'Open Jira Settings → System → Global automation.',
    `Create a flow named ${JSON.stringify(draft.name.trim() || 'Untitled workflow')} and choose the “${TRIGGERS[draft.trigger]}” trigger.`,
  ];
  const equal = (value: string, target: string) => `Add a smart values condition: ${value} equals ${JSON.stringify(target)}.`;
  if (draft.priority) steps.push(equal('{{alert.priority}}', draft.priority));
  if (draft.status) steps.push(equal('{{alert.status}}', JIRA_STATUS[draft.status]));
  if (draft.source.trim()) steps.push(equal('{{alert.source}}', draft.source.trim()));
  if (draft.message.trim()) steps.push(`Add a smart values condition: {{alert.message}} contains ${JSON.stringify(draft.message.trim())}.`);
  steps.push(
    `Add “${WORKFLOW_ACTIONS[draft.action]}”. ${draft.action === 'log'
      ? 'Start with “Alert {{alert.tinyId}} matched” as the log message.'
      : 'Choose an approved connection or recipients in Jira. Start with “Alert {{alert.tinyId}} matched”; only include alert content if that destination is authorized to receive it.'}`,
    'Test on a dedicated Jira site, then have an authorized operator enable the flow and review the Jira automation audit log.',
  );
  return steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

export function jiraHome(site: string | null | undefined): string | undefined {
  if (!site) return;
  try {
    const url = new URL(`https://${site}`);
    if (url.host === site && url.pathname === '/' && !url.username && !url.password) return url.origin;
  } catch {
    return;
  }
}
