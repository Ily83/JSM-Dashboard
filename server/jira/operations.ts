import type { ActionResult, AlertAction, DirectoryEntry, DirectoryUser } from '../../shared/actions';
import type { AlertOperations } from '../services/operations';
import type { JiraClient } from './client';

/**
 * Live implementation of AlertOperations: every call goes to Jira through
 * JiraClient. Directory lists change rarely and are cached for a few minutes.
 */

const DIRECTORY_TTL_MS = 5 * 60_000;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

export class JiraOperations implements AlertOperations {
  private teamsCache: Cached<DirectoryEntry[]> | null = null;
  private schedulesCache: Cached<DirectoryEntry[]> | null = null;
  private readonly escalationsCache = new Map<string, Cached<DirectoryEntry[]>>();
  private meCache: Cached<DirectoryUser> | null = null;

  constructor(private readonly client: JiraClient) {}

  perform(id: string, action: AlertAction): Promise<ActionResult> {
    return this.client.performAction(id, action);
  }

  notes(id: string) {
    return this.client.listNotes(id);
  }

  logs(id: string) {
    return this.client.listLogs(id);
  }

  attachments(id: string) {
    return this.client.listAttachments(id);
  }

  uploadAttachment(id: string, name: string, data: Buffer) {
    return this.client.uploadAttachment(id, name, data);
  }

  attachmentUrl(id: string, attachmentId: string) {
    return this.client.attachmentUrl(id, attachmentId);
  }

  searchUsers(query: string) {
    return this.client.searchUsers(query);
  }

  me() {
    this.meCache = fresh(this.meCache, () => this.client.myself());
    return this.meCache.value;
  }

  teams() {
    this.teamsCache = fresh(this.teamsCache, async () =>
      [...(await this.client.listTeams())].map(([id, name]) => ({ id, name })).sort(byName),
    );
    return this.teamsCache.value;
  }

  schedules() {
    this.schedulesCache = fresh(this.schedulesCache, async () => (await this.client.listSchedules()).sort(byName));
    return this.schedulesCache.value;
  }

  escalations(teamId: string) {
    const entry = fresh(this.escalationsCache.get(teamId) ?? null, async () => (await this.client.listEscalations(teamId)).sort(byName));
    this.escalationsCache.set(teamId, entry);
    return entry.value;
  }
}

function byName(a: DirectoryEntry, b: DirectoryEntry): number {
  return a.name.localeCompare(b.name);
}

/** Reuses a cached promise while it is young; a failed one is not kept. */
function fresh<T>(cached: Cached<T> | null, load: () => Promise<T>): Cached<T> {
  if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached;
  const entry: Cached<T> = { at: Date.now(), value: load() };
  entry.value.catch(() => {
    entry.at = 0;
  });
  return entry;
}
