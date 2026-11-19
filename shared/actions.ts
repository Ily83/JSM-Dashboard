import type { Priority, ResponderType } from './types';

/**
 * Write actions on alerts, and the read-only extras shown with them (notes,
 * activity log, attachments, and the pickers for people, teams, schedules
 * and escalations).
 *
 * Every action maps to one documented endpoint of the Jira Service
 * Management Operations REST API:
 *   acknowledge     POST  /v1/alerts/{id}/acknowledge
 *   unacknowledge   POST  /v1/alerts/{id}/unacknowledge
 *   close           POST  /v1/alerts/{id}/close
 *   snooze          POST  /v1/alerts/{id}/snooze          { endTime }
 *   assign          POST  /v1/alerts/{id}/assign          { accountId }
 *   addResponder    POST  /v1/alerts/{id}/responders      { id, type }
 *   escalate        POST  /v1/alerts/{id}/escalate        { escalationId }
 *   addNote         POST  /v1/alerts/{id}/notes           { note }
 *   priority        PATCH /v1/alerts/{id}/priority        { priority }
 *   addTags         POST  /v1/alerts/{id}/tags            { tags }
 *   removeTags      DELETE /v1/alerts/{id}/tags           { tags }
 *   customAction    POST  /v1/alerts/{id}/action          { actionName }
 * Jira processes them asynchronously; the backend follows up with
 * GET /v1/alerts/requests/{requestId} to learn the outcome.
 */

export const ACTION_IDS = [
  'acknowledge',
  'unacknowledge',
  'close',
  'snooze',
  'assign',
  'addResponder',
  'escalate',
  'addNote',
  'priority',
  'addTags',
  'removeTags',
  'customAction',
  'maintenance',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/** Actions that can be applied to several selected alerts at once. */
export const BULK_ACTION_IDS = ['acknowledge', 'unacknowledge', 'close'] as const satisfies readonly ActionId[];
export type BulkActionId = (typeof BULK_ACTION_IDS)[number];

export const ACTION_LABEL: Record<ActionId, string> = {
  acknowledge: 'Acknowledge',
  unacknowledge: 'Unacknowledge',
  close: 'Close',
  snooze: 'Snooze',
  assign: 'Assign',
  addResponder: 'Add responder',
  escalate: 'Escalate to next',
  addNote: 'Add note',
  priority: 'Change priority',
  addTags: 'Add tags',
  removeTags: 'Remove tags',
  customAction: 'Run action',
  maintenance: 'Maintenance windows',
};

export const NOTE_MAX_LENGTH = 25_000;
export const TAG_MAX_LENGTH = 100;
export const TAGS_MAX_PER_REQUEST = 20;
export const SNOOZE_MAX_DAYS = 30;

export type ResponderTarget = { id: string; type: Exclude<ResponderType, 'unknown'> };

export type AlertAction =
  | { action: 'acknowledge' }
  | { action: 'unacknowledge' }
  | { action: 'close' }
  | { action: 'snooze'; endTime: string }
  | { action: 'assign'; accountId: string }
  | { action: 'addResponder'; responder: ResponderTarget }
  | { action: 'escalate'; escalationId: string }
  | { action: 'addNote'; note: string }
  | { action: 'priority'; priority: Priority }
  | { action: 'addTags'; tags: string[] }
  | { action: 'removeTags'; tags: string[] }
  /** One of the alert's own custom actions (the `actions` list of the alert). */
  | { action: 'customAction'; actionName: string };

/**
 * done       Jira confirmed the action.
 * pending    Jira accepted the request but had not processed it when the
 *            backend stopped waiting; the next refresh shows the outcome.
 */
export type ActionState = 'done' | 'pending';

export interface ActionResult {
  state: ActionState;
  /** Jira's own outcome text when it reports one, e.g. "Alert acknowledged". */
  message: string | null;
}

export interface AlertNote {
  id: string;
  createdAt: number | null;
  note: string;
  owner: string | null;
}

export interface AlertLogEntry {
  time: number | null;
  type: string | null;
  text: string;
  owner: string | null;
}

export interface AlertAttachment {
  id: string;
  name: string;
  insertedAt: number | null;
}

export interface Page<T> {
  values: T[];
  /** More entries exist than were returned. */
  hasMore: boolean;
}

export interface DirectoryUser {
  accountId: string;
  displayName: string;
}

export interface DirectoryEntry {
  id: string;
  name: string;
}

/** What the current configuration allows. Sent with /api/status. */
export interface WriteCapabilities {
  enabled: boolean;
  actions: ActionId[];
}
