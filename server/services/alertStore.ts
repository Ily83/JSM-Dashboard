import { createHash } from 'node:crypto';
import type { Alert, AlertDetail, AlertsResponse, HistoryResponse, SyncMeta } from '../../shared/types';
import { JiraApiError } from '../jira/client';
import { toListItem } from '../jira/mapper';
import { log } from '../logger';
import type { AlertSource, HistoryPage, SourceSnapshot } from './source';

/**
 * In-memory cache in front of the alert source.
 *
 *  - Synchronisation is lazy: it runs only when a client asks for alerts and
 *    the cache is older than the TTL. Nobody watching means no Jira requests.
 *  - Single flight: concurrent requests (several tabs, several users) share
 *    one synchronisation.
 *  - On failure the last good data keeps being served, marked as stale, and
 *    the next attempt is delayed (longer after each consecutive failure, and
 *    for as long as Jira asks after a 429).
 *  - The list has a content version, so clients that already hold it receive
 *    a tiny "unchanged" answer instead of the whole list.
 */

const MAX_WAIT_WITH_CACHE_MS = 8_000;
const MIN_FORCED_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AlertStore {
  private snapshot: SourceSnapshot | null = null;
  private list: Alert[] = [];
  private version = 'none';
  private inFlight: Promise<void> | null = null;
  private readonly actionUpdates = new Map<string, AlertDetail | null>();
  private readonly detailRequests = new Map<string, Promise<AlertDetail | null>>();

  private lastSyncAt: number | null = null;
  private lastAttemptAt: number | null = null;
  private lastDurationMs: number | null = null;
  private lastError: string | null = null;
  private failures = 0;
  private retryAt: number | null = null;
  private retryIsRateLimit = false;

  constructor(
    private readonly source: AlertSource,
    private readonly ttlMs: number,
  ) {}

  get mode() {
    return this.source.mode;
  }

  meta(): SyncMeta {
    return {
      mode: this.source.mode,
      lastSyncAt: this.lastSyncAt,
      lastAttemptAt: this.lastAttemptAt,
      stale: this.lastError !== null,
      error: this.lastError,
      total: this.list.length,
      truncated: this.snapshot?.truncated ?? false,
      skipped: this.snapshot?.skipped ?? 0,
      lastSyncDurationMs: this.lastDurationMs,
      retryAt: this.retryAt !== null && this.retryAt > Date.now() ? this.retryAt : null,
    };
  }

  /**
   * Returns the alert list, synchronising first when the cache is too old.
   * `knownVersion` is the version the client already holds.
   */
  async getAlerts(options: { force?: boolean; knownVersion?: string } = {}): Promise<AlertsResponse> {
    await this.ensureFresh(options.force ?? false);
    const unchanged = options.knownVersion !== undefined && options.knownVersion === this.version;
    return { version: this.version, unchanged, alerts: unchanged ? [] : this.list, meta: this.meta() };
  }

  async getHistory(page: HistoryPage): Promise<HistoryResponse> {
    return this.source.loadHistory(page);
  }

  async getDetail(id: string): Promise<AlertDetail | null> {
    if (!this.snapshot) await this.ensureFresh(false);
    const current = this.snapshot?.alerts.get(id);
    if (current?.detailLoaded) return current;

    let request = this.detailRequests.get(id);
    if (!request) {
      request = this.source.loadDetail(id).finally(() => this.detailRequests.delete(id));
      this.detailRequests.set(id, request);
    }
    try {
      const detail = await request;
      if (!detail) return current ?? null;
      if (this.snapshot) {
        this.snapshot.alerts.set(id, detail);
        // Customers or service may only be known now: refresh the list too.
        this.rebuildList();
      }
      return detail;
    } catch (error) {
      if (!current) throw error;
      return { ...current, detailError: publicMessage(error) };
    }
  }

  /**
   * Reads one alert again from the source, bypassing the cache, and puts the
   * result into the list. Used after a write action. Returns null when the
   * alert no longer exists.
   */
  async refreshAlert(id: string): Promise<AlertDetail | null> {
    const detail = await this.source.loadDetail(id);
    if (this.snapshot || this.inFlight) this.actionUpdates.set(id, detail);
    if (this.snapshot) {
      if (detail) this.snapshot.alerts.set(id, detail);
      else this.snapshot.alerts.delete(id);
      this.rebuildList();
    }
    return detail;
  }

  private async ensureFresh(force: boolean): Promise<void> {
    const now = Date.now();
    const age = this.lastAttemptAt === null ? Infinity : now - this.lastAttemptAt;
    const minAge = force ? Math.min(this.ttlMs, MIN_FORCED_INTERVAL_MS) : this.ttlMs;
    // A manual refresh may skip the failure back-off, but never a rate limit.
    const waiting = this.retryAt !== null && now < this.retryAt && (this.retryIsRateLimit || !force);

    if (!this.inFlight && !waiting && age >= minAge) {
      this.inFlight = this.runSync().finally(() => {
        this.inFlight = null;
      });
    }
    if (!this.inFlight) return;
    // With data in hand, do not keep the client waiting on a slow Jira.
    if (this.snapshot) await Promise.race([this.inFlight, sleep(MAX_WAIT_WITH_CACHE_MS)]);
    else await this.inFlight;
  }

  /** Never throws: failures are recorded and reported through meta(). */
  private async runSync(): Promise<void> {
    const started = Date.now();
    this.lastAttemptAt = started;
    try {
      const snapshot = await this.source.sync(this.snapshot);
      // The list can lag behind the post-action detail, especially during an overlapping sync.
      for (const [id, detail] of this.actionUpdates) {
        if (!detail) snapshot.alerts.delete(id);
        else if ((snapshot.alerts.get(id)?.updatedAt ?? -Infinity) <= detail.updatedAt) snapshot.alerts.set(id, detail);
      }
      this.actionUpdates.clear();
      this.snapshot = snapshot;
      this.rebuildList();
      this.lastSyncAt = Date.now();
      this.lastError = null;
      this.failures = 0;
      this.retryAt = null;
      this.retryIsRateLimit = false;
    } catch (error) {
      this.failures += 1;
      this.lastError = publicMessage(error);
      const rateLimited = error instanceof JiraApiError && error.kind === 'rate_limit';
      const backoff = Math.min(MAX_BACKOFF_MS, this.ttlMs * 2 ** Math.min(this.failures - 1, 6));
      const wait = rateLimited ? Math.max(error.retryAfterMs ?? 0, backoff) : backoff;
      this.retryAt = Date.now() + wait;
      this.retryIsRateLimit = rateLimited;
      log.warn('alert sync failed, serving cached data', {
        kind: error instanceof JiraApiError ? error.kind : 'internal',
        status: error instanceof JiraApiError ? (error.status ?? 'none') : 'none',
        failures: this.failures,
        retryInSeconds: Math.round(wait / 1000),
      });
      if (!(error instanceof JiraApiError)) {
        log.error('unexpected sync error', { name: error instanceof Error ? error.name : 'unknown' });
      }
    } finally {
      this.lastDurationMs = Date.now() - started;
    }
  }

  private rebuildList(): void {
    if (!this.snapshot) return;
    const list = [...this.snapshot.alerts.values()].map(toListItem);
    list.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    const version = createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);
    if (version !== this.version) {
      this.version = version;
      this.list = list;
    }
  }
}

function publicMessage(error: unknown): string {
  if (error instanceof JiraApiError) return error.publicMessage;
  return 'The backend failed to load alerts. See the server log for details.';
}
