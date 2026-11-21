import { z } from 'zod';
import {
  NOTE_MAX_LENGTH,
  SNOOZE_MAX_DAYS,
  TAG_MAX_LENGTH,
  TAGS_MAX_PER_REQUEST,
  type ActionId,
  type ActionResult,
  type AlertAction,
  type AlertAttachment,
  type AlertLogEntry,
  type AlertNote,
  type DirectoryEntry,
  type DirectoryUser,
  type Page,
} from '../../shared/actions';
import { PRIORITIES, type AlertDetail } from '../../shared/types';
import { log } from '../logger';
import type { AlertStore } from './alertStore';

/**
 * Everything beyond the alert list: write actions, notes, activity log,
 * attachments, and the directory used by the pickers. Implemented by
 * JiraOperations (live) and DemoSource (in-memory sample data).
 */
export interface AlertOperations {
  perform(id: string, action: AlertAction): Promise<ActionResult>;
  notes(id: string): Promise<Page<AlertNote>>;
  logs(id: string): Promise<Page<AlertLogEntry>>;
  attachments(id: string): Promise<Page<AlertAttachment>>;
  uploadAttachment?(id: string, name: string, data: Buffer): Promise<AlertAttachment>;
  /** Temporary download link, or null when there is none (demo mode). */
  attachmentUrl(id: string, attachmentId: string): Promise<string | null>;
  searchUsers(query: string): Promise<DirectoryUser[]>;
  /** The account behind the configured credentials. */
  me(): Promise<DirectoryUser | null>;
  teams(): Promise<DirectoryEntry[]>;
  schedules(): Promise<DirectoryEntry[]>;
  escalations(teamId: string): Promise<DirectoryEntry[]>;
}

// ---- Validation of incoming action requests -------------------------------

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/, 'invalid id');
const noteId = ID.refine(id => id !== '.' && id !== '..', 'invalid note id');

const tagList = z
  .array(z.string().trim().min(1).max(TAG_MAX_LENGTH))
  .min(1)
  .max(TAGS_MAX_PER_REQUEST)
  .transform((tags) => [...new Set(tags)]);

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acknowledge') }),
  z.object({ action: z.literal('unacknowledge') }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('snooze'), endTime: z.iso.datetime({ offset: true }) }),
  z.object({ action: z.literal('assign'), accountId: ID }),
  z.object({
    action: z.literal('addResponder'),
    responder: z.object({ id: ID, type: z.enum(['team', 'user', 'escalation', 'schedule']) }),
  }),
  z.object({ action: z.literal('escalate'), escalationId: ID }),
  z.object({ action: z.literal('addNote'), note: z.string().trim().min(1).max(NOTE_MAX_LENGTH) }),
  z.object({ action: z.literal('editNote'), noteId, note: z.string().trim().min(1).max(NOTE_MAX_LENGTH) }),
  z.object({ action: z.literal('deleteNote'), noteId }),
  z.object({ action: z.literal('priority'), priority: z.enum(PRIORITIES) }),
  z.object({ action: z.literal('addTags'), tags: tagList }),
  z.object({ action: z.literal('removeTags'), tags: tagList }),
  z.object({ action: z.literal('customAction'), actionName: z.string().trim().min(1).max(200) }),
]);

export class ActionRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ActionRequestError';
  }
}

/** Parses a request body into an action, or throws ActionRequestError (400). */
export function parseAction(body: unknown, now = Date.now()): AlertAction {
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    // Field names only, never the submitted values.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'action'))].join(', ');
    throw new ActionRequestError(400, `Invalid action request (${fields}).`);
  }
  const action = parsed.data;
  if (action.action === 'snooze') {
    const end = Date.parse(action.endTime);
    if (end < now + 60_000) throw new ActionRequestError(400, 'The snooze end must be at least one minute from now.');
    if (end > now + SNOOZE_MAX_DAYS * 86_400_000) throw new ActionRequestError(400, `Snooze for at most ${SNOOZE_MAX_DAYS} days.`);
    return { action: 'snooze', endTime: new Date(end).toISOString() };
  }
  return action;
}

// ---- Running actions --------------------------------------------------------

export interface ActionOutcome {
  result: ActionResult;
  /** The alert as Jira reports it after the action, when it could be read. */
  alert: AlertDetail | null;
}

/**
 * Gatekeeper for write actions: only enabled actions run, every request is
 * validated, every outcome is logged (action, alert id and result, never
 * note text or tag values), and the cached alert is refreshed afterwards so
 * every connected browser sees the change on its next poll.
 */
export class ActionService {
  private readonly allowed: ReadonlySet<ActionId>;

  constructor(
    private readonly operations: AlertOperations,
    private readonly store: AlertStore,
    allowed: readonly ActionId[],
  ) {
    this.allowed = new Set(allowed);
  }

  get enabled(): boolean {
    return this.allowed.size > 0;
  }

  isAllowed(action: ActionId): boolean {
    return this.allowed.has(action);
  }

  async run(id: string, body: unknown): Promise<ActionOutcome> {
    if (!this.enabled) {
      throw new ActionRequestError(403, 'Write actions are turned off. Set JIRA_WRITE_ACTIONS in .env to enable them.');
    }
    const action = parseAction(body);
    if (!this.allowed.has(action.action)) {
      throw new ActionRequestError(403, `The action "${action.action}" is not enabled in JIRA_WRITE_ACTIONS.`);
    }
    if (action.action === 'customAction') {
      // Only an action the alert itself offers; never a name made up in the browser.
      const detail = await this.store.getDetail(id);
      if (!detail?.actions.includes(action.actionName)) {
        throw new ActionRequestError(400, 'This alert does not offer that action.');
      }
    }
    const started = Date.now();
    let result: ActionResult;
    try {
      result = await this.operations.perform(id, action);
    } catch (error) {
      log.warn('alert action failed', { action: action.action, alert: id, ms: Date.now() - started });
      throw error;
    }
    log.info('alert action', { action: action.action, alert: id, state: result.state, ms: Date.now() - started });

    let alert: AlertDetail | null = null;
    try {
      alert = await this.store.refreshAlert(id);
    } catch {
      // The action went through; the list catches up on the next sync.
    }
    return { result, alert };
  }
}
