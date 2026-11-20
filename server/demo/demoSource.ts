import type {
  ActionResult,
  AlertAction,
  AlertAttachment,
  AlertLogEntry,
  AlertNote,
  DirectoryEntry,
  DirectoryUser,
  Page,
} from '../../shared/actions';
import { HISTORY_MAX_OFFSET, HISTORY_PAGE_SIZE } from '../../shared/history';
import type { AlertDetail, ExtractionRules, HistoryResponse } from '../../shared/types';
import { JiraApiError } from '../jira/client';
import { mapAlert, toListItem, type MapContext } from '../jira/mapper';
import { RawAlertSchema, type RawAlert } from '../jira/schemas';
import type { CustomerMap } from '../customerMap';
import type { AlertOperations } from '../services/operations';
import type { AlertSource, HistoryPage, SourceSnapshot } from '../services/source';
import { buildDemoAlerts, DEMO_ESCALATIONS, DEMO_ME, DEMO_RESPONDER_NAMES, DEMO_SCHEDULES, DEMO_TEAMS, DEMO_USERS } from './demoData';

/**
 * Serves sample alerts without contacting Jira. The data is created once at
 * start-up (timestamps are relative to that moment) and passes through the
 * same validation and mapping as live data.
 *
 * Write actions change this in-memory copy only, with the same rules Jira
 * applies, so every button can be tried safely. A restart resets everything.
 */

/** The fictional person to assign, or Jira's 422 for an unknown account. */
function demoUser(accountId: string): { accountId: string; displayName: string } {
  const user = DEMO_USERS.find((u) => u.accountId === accountId) ?? (DEMO_ME.accountId === accountId ? DEMO_ME : null);
  if (!user) throw new JiraApiError('validation', 422, 'Jira rejected the request (422).');
  return user;
}

/** Name of a fictional escalation, or Jira's 422 for an unknown one. */
function escalationName(escalationId: string): string {
  const name = Object.values(DEMO_ESCALATIONS).flat().find((e) => e.id === escalationId)?.name;
  if (!name) throw new JiraApiError('validation', 422, 'Jira rejected the request (422).');
  return name;
}

/** The alert's responders with `responder` added, unless one with its id is there already. */
function withResponder(raw: RawAlert, responder: { id: string; type: string }): NonNullable<RawAlert['responders']> {
  const responders = [...(raw.responders ?? [])];
  if (!responders.some((r) => r.id === responder.id)) responders.push(responder);
  return responders;
}

export class DemoSource implements AlertSource, AlertOperations {
  readonly mode = 'demo' as const;
  private readonly snapshot: SourceSnapshot;
  private readonly raws = new Map<string, RawAlert>();
  private readonly ctx: MapContext;
  private readonly notesById = new Map<string, AlertNote[]>();
  private readonly logsById = new Map<string, AlertLogEntry[]>();
  private nextNoteId = 1;

  /** Delay that imitates Jira's asynchronous processing, in milliseconds. */
  actionDelayMs = 350;

  constructor(rules: ExtractionRules, extraAlerts = 0, now = Date.now(), customerMap: CustomerMap | null = null) {
    this.ctx = {
      rules,
      teamNames: DEMO_TEAMS,
      otherNames: DEMO_RESPONDER_NAMES,
      alertUrl: () => null,
      ...(customerMap ? { customersForEntity: (entity: string | null) => customerMap.lookup(entity) } : {}),
    };
    const alerts = new Map<string, AlertDetail>();
    let skipped = 0;
    for (const raw of buildDemoAlerts(now, extraAlerts)) {
      const parsed = RawAlertSchema.safeParse(raw);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      this.raws.set(parsed.data.id, parsed.data);
      alerts.set(parsed.data.id, mapAlert(parsed.data, this.ctx, true));
    }
    this.snapshot = { alerts, truncated: false, skipped };
  }

  async sync(): Promise<SourceSnapshot> {
    return this.snapshot;
  }

  async loadHistory({ from, until, offset }: HistoryPage): Promise<HistoryResponse> {
    const matches = [...this.snapshot.alerts.values()]
      .filter((alert) => alert.createdAt >= from && alert.createdAt < until)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const more = offset + HISTORY_PAGE_SIZE < matches.length;
    const atLimit = offset >= HISTORY_MAX_OFFSET;
    return {
      alerts: matches.slice(offset, offset + HISTORY_PAGE_SIZE).map(toListItem),
      hasNext: more && !atLimit,
      truncated: matches.length > HISTORY_MAX_OFFSET + HISTORY_PAGE_SIZE,
      skipped: this.snapshot.skipped,
    };
  }

  async loadDetail(id: string): Promise<AlertDetail | null> {
    return this.snapshot.alerts.get(id) ?? null;
  }

  // ---- Write actions ------------------------------------------------------

  async perform(id: string, action: AlertAction): Promise<ActionResult> {
    const raw = this.raws.get(id);
    if (!raw) throw new JiraApiError('not_found', 404, 'Jira did not find it (404). The alert may have been deleted.');
    await new Promise((resolve) => setTimeout(resolve, this.actionDelayMs));

    const now = new Date().toISOString();
    const closed = (raw.status ?? '').toLowerCase() === 'closed';
    const next: RawAlert = { ...raw, updatedAt: now };
    let text: string;

    // Jira refuses most changes on a closed alert; notes and tags remain possible.
    if (closed && !['addNote', 'addTags', 'removeTags', 'close'].includes(action.action)) {
      throw new JiraApiError('validation', 200, 'Jira did not apply the action: Alert is closed');
    }

    switch (action.action) {
      case 'acknowledge':
        // As seen on a live site: acknowledging makes the acknowledging account the owner.
        Object.assign(next, { status: 'acked', acknowledged: true, snoozed: false, snoozedUntil: undefined, ackTime: now, owner: raw.owner ?? DEMO_ME.displayName });
        text = 'Alert acknowledged';
        break;
      case 'unacknowledge':
        // ...and unacknowledging clears the owner again.
        Object.assign(next, { status: 'open', acknowledged: false, ackTime: undefined, owner: undefined });
        text = 'Alert unacknowledged';
        break;
      case 'close':
        if (closed) return { state: 'done', message: 'Alert is already closed' };
        Object.assign(next, { status: 'closed', snoozed: false, snoozedUntil: undefined, closeTime: now });
        text = 'Alert closed';
        break;
      case 'snooze':
        Object.assign(next, { status: 'snoozed', snoozed: true, snoozedUntil: action.endTime });
        text = `Alert snoozed until ${action.endTime.slice(0, 16).replace('T', ' ')} UTC`;
        break;
      case 'assign': {
        const user = demoUser(action.accountId);
        next.owner = user.displayName;
        text = `Alert owner changed to ${user.displayName}`;
        break;
      }
      case 'addResponder':
        next.responders = withResponder(raw, { ...action.responder });
        text = `Responder added: ${this.responderName(action.responder.type, action.responder.id)}`;
        break;
      case 'escalate': {
        const name = escalationName(action.escalationId);
        next.responders = withResponder(raw, { id: action.escalationId, type: 'escalation' });
        text = `Escalated to next level of ${name}`;
        break;
      }
      case 'addNote': {
        const notes = this.notesById.get(id) ?? [];
        notes.unshift({ id: `demo-note-${this.nextNoteId++}`, createdAt: Date.parse(now), note: action.note, owner: DEMO_ME.displayName });
        this.notesById.set(id, notes);
        text = 'Note added';
        break;
      }
      case 'priority':
        text = `Priority changed from ${raw.priority ?? 'P3'} to ${action.priority}`;
        next.priority = action.priority;
        break;
      case 'addTags':
        next.tags = [...new Set([...(raw.tags ?? []), ...action.tags])];
        text = `Tags added: ${action.tags.join(', ')}`;
        break;
      case 'customAction':
        if (!(raw.actions ?? []).includes(action.actionName)) throw new JiraApiError('validation', 422, 'Jira rejected the request (422).');
        text = `Custom action "${action.actionName}" executed`;
        break;
      case 'removeTags': {
        const remove = new Set(action.tags);
        next.tags = (raw.tags ?? []).filter((t) => !remove.has(t));
        text = `Tags removed: ${action.tags.join(', ')}`;
        break;
      }
    }

    this.raws.set(id, next);
    this.snapshot.alerts.set(id, mapAlert(next, this.ctx, true));
    this.appendLog(id, { time: Date.parse(now), type: 'alertAction', text, owner: DEMO_ME.displayName });
    return { state: 'done', message: text };
  }

  // ---- Notes, activity log, attachments ------------------------------------

  async notes(id: string): Promise<Page<AlertNote>> {
    this.requireAlert(id);
    return { values: this.notesById.get(id) ?? [], hasMore: false };
  }

  async logs(id: string): Promise<Page<AlertLogEntry>> {
    const raw = this.requireAlert(id);
    const created: AlertLogEntry = {
      time: raw.createdAt ? Date.parse(raw.createdAt) : null,
      type: 'system',
      text: `Alert created via ${raw.integrationName ?? raw.source ?? 'API'}`,
      owner: 'System',
    };
    return { values: [...(this.logsById.get(id) ?? []), created], hasMore: false };
  }

  async attachments(id: string): Promise<Page<AlertAttachment>> {
    this.requireAlert(id);
    return { values: [], hasMore: false };
  }

  async attachmentUrl(): Promise<string | null> {
    return null;
  }

  // ---- Directory -------------------------------------------------------------

  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const needle = query.trim().toLowerCase();
    return [DEMO_ME, ...DEMO_USERS].filter((u) => u.displayName.toLowerCase().includes(needle)).slice(0, 20);
  }

  async me(): Promise<DirectoryUser> {
    return DEMO_ME;
  }

  async teams(): Promise<DirectoryEntry[]> {
    return [...DEMO_TEAMS].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async schedules(): Promise<DirectoryEntry[]> {
    return DEMO_SCHEDULES;
  }

  async escalations(teamId: string): Promise<DirectoryEntry[]> {
    return DEMO_ESCALATIONS[teamId] ?? [];
  }

  private requireAlert(id: string): RawAlert {
    const raw = this.raws.get(id);
    if (!raw) throw new JiraApiError('not_found', 404, 'Jira did not find it (404). The alert may have been deleted.');
    return raw;
  }

  private appendLog(id: string, entry: AlertLogEntry): void {
    const entries = this.logsById.get(id) ?? [];
    entries.unshift(entry);
    this.logsById.set(id, entries.slice(0, 200));
  }

  private responderName(type: string, id: string): string {
    if (type === 'team') return DEMO_TEAMS.get(id) ?? id;
    if (type === 'user') return [DEMO_ME, ...DEMO_USERS].find((u) => u.accountId === id)?.displayName ?? id;
    if (type === 'schedule') return DEMO_SCHEDULES.find((s) => s.id === id)?.name ?? id;
    return Object.values(DEMO_ESCALATIONS).flat().find((e) => e.id === id)?.name ?? id;
  }
}
