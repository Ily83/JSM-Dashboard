import type { AlertAction, BulkActionId } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';

/**
 * Rules and wording of the alert menu and the bulk bar, kept free of React
 * so they can be tested.
 *
 * Questions name the action, the count and the chosen value ("Assign 3
 * alerts to Priya Nair?"); results say what happened, in the past tense,
 * with the count as a noun ("3 alerts assigned to Priya Nair").
 */

/** Note edits and deletes are scoped to one note in the detail panel. */
export type BulkRequest = Exclude<AlertAction, { action: 'editNote' | 'deleteNote' }>;
export type BulkOperation = BulkRequest['action'];
/** Actions that need a choice first (who, until when, which tags, ...). */
export type PickerAction = Exclude<BulkOperation, BulkActionId>;

/** Whether the action can be sent for this alert; the others in a selection are skipped. */
export function appliesTo(action: BulkOperation, alert: Alert): boolean {
  if (alert.status === 'closed') return action === 'addNote' || action === 'addTags' || action === 'removeTags';
  if (action === 'acknowledge') return !alert.acknowledged;
  if (action === 'unacknowledge') return alert.acknowledged;
  return true;
}

/** "1 alert", "3 alerts". */
export function alertCount(n: number): string {
  return `${n} alert${n === 1 ? '' : 's'}`;
}

/**
 * Closing always asks, and so does a custom action (it can do anything).
 * Everything else asks only when it affects more than one alert: the
 * backlog requires the count to be confirmed before a bulk action.
 */
export function needsConfirm(action: BulkOperation, targets: number): boolean {
  return action === 'close' || action === 'customAction' || targets > 1;
}

function tagList(tags: readonly string[]): string {
  return tags.join(', ');
}

/**
 * The question before an action on `n` alerts. `name` is the display text of
 * the chosen value where the request only holds an id: a person, a team, an
 * escalation, or the formatted snooze end.
 */
export function questionText(request: BulkRequest, n: number, name?: string): string {
  const alerts = alertCount(n);
  switch (request.action) {
    case 'acknowledge':
      return `Acknowledge ${alerts}?`;
    case 'unacknowledge':
      return `Unacknowledge ${alerts}?`;
    case 'close':
      return `Close ${alerts}?`;
    case 'assign':
      return `Assign ${alerts} to ${name ?? 'this person'}?`;
    case 'snooze':
      return `Snooze ${alerts} until ${name ?? request.endTime}?`;
    case 'priority':
      return `Set ${alerts} to ${request.priority}?`;
    case 'addResponder':
      return `Add ${name ?? 'this responder'} to ${alerts}?`;
    case 'escalate':
      return `Escalate ${alerts} via ${name ?? 'this escalation'}?`;
    case 'addTags':
      return `Tag ${alerts} with ${tagList(request.tags)}?`;
    case 'removeTags':
      return `Remove ${request.tags.length === 1 ? 'tag' : 'tags'} ${tagList(request.tags)} from ${alerts}?`;
    case 'addNote':
      return `Add note to ${alerts}?`;
    case 'customAction':
      return `Run “${request.actionName}” on ${alerts}?`;
  }
}

/** What happened to the `n` alerts Jira accepted. */
export function resultText(request: BulkRequest, n: number, name?: string): string {
  const alerts = alertCount(n);
  switch (request.action) {
    case 'acknowledge':
      return `${alerts} acknowledged`;
    case 'unacknowledge':
      return `${alerts} unacknowledged`;
    case 'close':
      return `${alerts} closed`;
    case 'assign':
      return name ? `${alerts} assigned to ${name}` : `${alerts} assigned`;
    case 'snooze':
      return name ? `${alerts} snoozed until ${name}` : `${alerts} snoozed`;
    case 'priority':
      return `${alerts} set to ${request.priority}`;
    case 'addResponder':
      return name ? `${name} added to ${alerts}` : `Responder added to ${alerts}`;
    case 'escalate':
      return name ? `${alerts} escalated via ${name}` : `${alerts} escalated`;
    case 'addTags':
      return `${alerts} tagged ${tagList(request.tags)}`;
    case 'removeTags':
      return `${request.tags.length === 1 ? 'Tag' : 'Tags'} ${tagList(request.tags)} removed from ${alerts}`;
    case 'addNote':
      return `Note added to ${alerts}`;
    case 'customAction':
      return `“${request.actionName}” run on ${alerts}`;
  }
}

/** The label of the button that confirms the question: the verb itself. */
export const CONFIRM_LABEL: Record<BulkOperation, string> = {
  acknowledge: 'Acknowledge',
  unacknowledge: 'Unacknowledge',
  close: 'Close',
  assign: 'Assign',
  snooze: 'Snooze',
  priority: 'Set priority',
  addResponder: 'Add',
  escalate: 'Escalate',
  addTags: 'Add tags',
  removeTags: 'Remove',
  addNote: 'Add note',
  customAction: 'Run',
};
