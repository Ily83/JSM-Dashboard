import { HISTORY_MAX_OFFSET, HISTORY_PAGE_SIZE } from '../../shared/history';
import type { AlertDetail, ExtractionRules, HistoryResponse } from '../../shared/types';
import type { JiraConfig } from '../config';
import type { CustomerMap } from '../customerMap';
import { log } from '../logger';
import type { AlertSource, HistoryPage, SourceSnapshot } from '../services/source';
import { JiraApiError, JiraClient, MAX_OFFSET_PLUS_SIZE, MAX_PAGE_SIZE, type AlertPage } from './client';
import { mapAlert, toListItem, type MapContext } from './mapper';
import type { RawAlert } from './schemas';

/**
 * Synchronises alerts from Jira with as few requests as possible.
 *
 * The list endpoint has no "changed since" filter (the documented search
 * fields include createdAt and lastOccurredAt but not updatedAt), so true
 * delta queries are not possible. Instead there are two kinds of run:
 *
 *   Full sync   (first run, then every JIRA_FULL_SYNC_MINUTES)
 *     - all open alerts (JIRA_OPEN_QUERY), newest first, up to JIRA_MAX_ALERTS
 *     - closed alerts (JIRA_CLOSED_QUERY) created within the lookback window
 *     - team names, to label responders
 *
 *   Light sync  (every other run)
 *     - open alerts only
 *     - alerts that were open last time and are missing now are fetched one
 *       by one (Get alert) to learn their new state
 *     - closed alerts are carried over from the cache
 *
 * Per-alert detail (description, extra properties) is cached by alert id and
 * `updatedAt`, so an unchanged alert is never fetched twice.
 */

const MAX_DISAPPEARED_LOOKUPS = 40;
/** Closed alerts whose details are read per run in "auto" mode, after the open ones. */
const CLOSED_ENRICH_PER_SYNC = 10;

interface CachedDetail {
  updatedAt: string | null | undefined;
  description: RawAlert['description'];
  extraProperties: RawAlert['extraProperties'];
  actions: RawAlert['actions'];
}

interface FetchResult {
  raws: RawAlert[];
  total: number | null;
  skipped: number;
}

/** Adds the alerts of one page by id and returns how many items it skipped. */
function collectPage(byId: Map<string, RawAlert>, page: AlertPage): number {
  for (const raw of page.alerts) byId.set(raw.id, raw);
  return page.skipped;
}

/** Offsets of the pages after the first one, up to `wanted` alerts and the API's offset limit. */
function laterOffsets(pageSize: number, wanted: number): number[] {
  const offsets: number[] = [];
  for (let offset = pageSize; offset < wanted && offset + pageSize < MAX_OFFSET_PLUS_SIZE; offset += pageSize) {
    offsets.push(offset);
  }
  return offsets;
}

export class JiraSource implements AlertSource {
  readonly mode = 'live' as const;
  private lastFullAt = 0;
  private readonly teamNames: Map<string, string> = new Map();
  private readonly details = new Map<string, CachedDetail>();
  private readonly ctx: MapContext;

  constructor(
    private readonly config: JiraConfig,
    rules: ExtractionRules,
    private readonly client: JiraClient = new JiraClient(config),
    customerMap: CustomerMap | null = null,
  ) {
    const template = config.alertUrlTemplate;
    this.ctx = {
      rules,
      teamNames: this.teamNames,
      ...(customerMap ? { customersForEntity: (entity: string | null) => customerMap.lookup(entity) } : {}),
      alertUrl: (id) =>
        template.replaceAll('{siteUrl}', config.siteUrl).replaceAll('{id}', encodeURIComponent(id)),
    };
  }

  async sync(previous: SourceSnapshot | null): Promise<SourceSnapshot> {
    const now = Date.now();
    const full = !previous || now - this.lastFullAt >= this.config.fullSyncMinutes * 60_000;
    const requestsBefore = this.client.requestCount;

    const snapshot = full ? await this.fullSync(previous, now) : await this.lightSync(previous, now);
    await this.enrich(snapshot.alerts);

    if (full) this.lastFullAt = now;
    this.pruneDetailCache(snapshot.alerts);
    log.info('jira sync complete', {
      kind: full ? 'full' : 'light',
      alerts: snapshot.alerts.size,
      requests: this.client.requestCount - requestsBefore,
      skipped: snapshot.skipped,
    });
    return snapshot;
  }

  async loadDetail(id: string): Promise<AlertDetail | null> {
    try {
      const raw = await this.client.getAlert(id);
      this.rememberDetail(raw);
      return mapAlert(raw, this.ctx, true);
    } catch (error) {
      if (error instanceof JiraApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  async loadHistory({ from, until, offset }: HistoryPage): Promise<HistoryResponse> {
    const page = await this.client.listAlerts({
      query: this.query(`createdAt >= ${from} AND createdAt < ${until}`),
      offset,
      size: HISTORY_PAGE_SIZE,
    });
    const total = page.total ?? 0;
    const more = page.hasNext || total > offset + HISTORY_PAGE_SIZE;
    const atLimit = offset >= HISTORY_MAX_OFFSET;
    return {
      alerts: page.alerts.map((raw) => toListItem(mapAlert(raw, this.ctx, false))),
      hasNext: more && !atLimit,
      truncated: total > HISTORY_MAX_OFFSET + HISTORY_PAGE_SIZE || (more && atLimit),
      skipped: page.skipped,
    };
  }

  private async fullSync(previous: SourceSnapshot | null, now: number): Promise<SourceSnapshot> {
    await this.refreshTeams();
    const lookbackStart = now - this.config.closedLookbackHours * 3_600_000;
    const wantClosed = this.config.maxClosedAlerts > 0 && this.config.closedLookbackHours > 0;

    const [open, closed] = await Promise.all([
      this.fetchAll(this.query(this.config.openQuery), this.config.maxOpenAlerts),
      wantClosed
        ? this.fetchAll(this.query(`createdAt > ${lookbackStart} AND (${this.config.closedQuery})`), this.config.maxClosedAlerts)
        : Promise.resolve<FetchResult>({ raws: [], total: 0, skipped: 0 }),
    ]);

    const alerts = new Map<string, AlertDetail>();
    for (const raw of closed.raws) alerts.set(raw.id, this.map(raw));
    for (const raw of open.raws) alerts.set(raw.id, this.map(raw));
    // Alerts created before the lookback window but closed recently are not
    // returned by the query above; keep the ones this process already knows.
    this.carryOverClosed(previous, alerts, lookbackStart);

    return {
      alerts,
      truncated: (open.total ?? 0) > this.config.maxOpenAlerts,
      skipped: open.skipped + closed.skipped,
    };
  }

  private async lightSync(previous: SourceSnapshot, now: number): Promise<SourceSnapshot> {
    const open = await this.fetchAll(this.query(this.config.openQuery), this.config.maxOpenAlerts);
    const truncated = (open.total ?? 0) > this.config.maxOpenAlerts;

    const alerts = new Map<string, AlertDetail>();
    for (const raw of open.raws) alerts.set(raw.id, this.map(raw));

    // Alerts that left the open list were most likely closed. When the list is
    // truncated, absence proves nothing, so they are simply dropped.
    const disappeared = truncated
      ? []
      : [...previous.alerts.values()].filter((a) => a.status !== 'closed' && !alerts.has(a.id));
    if (disappeared.length > MAX_DISAPPEARED_LOOKUPS) {
      log.info('many alerts left the open list, running a full sync instead', { count: disappeared.length });
      return this.fullSync(previous, now);
    }
    await Promise.all(
      disappeared.map(async (alert) => {
        try {
          const detail = await this.loadDetail(alert.id);
          if (detail) alerts.set(detail.id, detail);
        } catch {
          alerts.set(alert.id, alert); // keep the last known state; retried next run
        }
      }),
    );

    this.carryOverClosed(previous, alerts, now - this.config.closedLookbackHours * 3_600_000);
    return { alerts, truncated, skipped: open.skipped };
  }

  private carryOverClosed(previous: SourceSnapshot | null, into: Map<string, AlertDetail>, lookbackStart: number): void {
    if (!previous) return;
    for (const alert of previous.alerts.values()) {
      if (alert.status !== 'closed' || into.has(alert.id)) continue;
      if ((alert.closeTime ?? alert.updatedAt) >= lookbackStart) into.set(alert.id, alert);
    }
  }

  /**
   * Fetches description and extra properties for alerts whose list entry did
   * not include them. Bounded per run, so a large backlog is filled in over
   * several runs instead of in one burst of requests.
   */
  private async enrich(alerts: Map<string, AlertDetail>): Promise<void> {
    const mode = this.config.enrichDetails;
    if (mode === 'never' || this.config.enrichMaxPerSync === 0) return;
    const budget = this.config.enrichMaxPerSync;
    const missing = [...alerts.values()].filter((a) => !a.detailLoaded).sort((a, b) => b.createdAt - a.createdAt);
    const open = missing.filter((a) => a.status !== 'closed');
    const closed = missing.filter((a) => a.status === 'closed');
    // Open alerts first. In "auto" mode a few closed ones per run as well, so
    // an alert closed before its details were read still gets its service
    // and customers from extra properties; once read, they are cached.
    const closedShare = mode === 'always' ? budget : Math.min(CLOSED_ENRICH_PER_SYNC, Math.max(0, budget - open.length));
    const candidates = [...open.slice(0, budget), ...closed.slice(0, closedShare)].slice(0, budget);
    if (candidates.length === 0) return;

    // Two at a time: enrichment is background work and must leave room in
    // Jira's rate limit for the list requests and for user actions.
    let stop = false;
    let next = 0;
    const worker = async () => {
      while (!stop && next < candidates.length) {
        const alert = candidates[next++];
        try {
          const detail = await this.loadDetail(alert.id);
          if (detail) alerts.set(detail.id, detail);
        } catch (error) {
          // Back off for this run as soon as Jira pushes back.
          if (error instanceof JiraApiError && error.kind !== 'not_found') stop = true;
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  /** Reads every page of a query, up to `limit` alerts. */
  private async fetchAll(query: string, limit: number): Promise<FetchResult> {
    const byId = new Map<string, RawAlert>();
    const pageSize = Math.min(MAX_PAGE_SIZE, limit);

    const first = await this.client.listAlerts({ query, offset: 0, size: pageSize });
    let skipped = collectPage(byId, first);
    if (!first.hasNext) return { raws: [...byId.values()], total: first.total, skipped };

    const offsets = laterOffsets(pageSize, Math.min(limit, first.total ?? limit));
    const laterSkipped =
      first.total === null
        ? await this.fetchPagesInOrder(query, offsets, pageSize, byId)
        : await this.fetchPagesConcurrently(query, offsets, pageSize, byId);
    skipped += laterSkipped;
    return { raws: [...byId.values()].slice(0, limit), total: first.total, skipped };
  }

  /**
   * Total is known: remaining pages can be requested concurrently (the
   * client caps concurrency). Returns the number of skipped items.
   */
  private async fetchPagesConcurrently(query: string, offsets: number[], size: number, byId: Map<string, RawAlert>): Promise<number> {
    const pages = await Promise.all(offsets.map((offset) => this.client.listAlerts({ query, offset, size })));
    let skipped = 0;
    for (const page of pages) skipped += collectPage(byId, page);
    return skipped;
  }

  /** Total is unknown: one page after the other until the last. Returns the number of skipped items. */
  private async fetchPagesInOrder(query: string, offsets: number[], size: number, byId: Map<string, RawAlert>): Promise<number> {
    let skipped = 0;
    for (const offset of offsets) {
      const page = await this.client.listAlerts({ query, offset, size });
      skipped += collectPage(byId, page);
      if (!page.hasNext) break;
    }
    return skipped;
  }

  private query(base: string): string {
    return this.config.alertQuery ? `(${this.config.alertQuery}) AND ${base}` : base;
  }

  private map(raw: RawAlert): AlertDetail {
    if (raw.extraProperties === undefined || raw.extraProperties === null) {
      const cached = this.details.get(raw.id);
      if (cached) {
        const merged = {
          ...raw,
          extraProperties: cached.extraProperties,
          description: raw.description ?? cached.description,
          actions: raw.actions ?? cached.actions,
        };
        if (cached.updatedAt === raw.updatedAt) return mapAlert(merged, this.ctx, true);
        // The alert changed since its details were read (acknowledged,
        // closed...). Extra properties rarely change: keep showing them, and
        // let the next enrichment read them again.
        return { ...mapAlert(merged, this.ctx, false), detailLoaded: false };
      }
    }
    return mapAlert(raw, this.ctx);
  }

  private rememberDetail(raw: RawAlert): void {
    this.details.set(raw.id, {
      updatedAt: raw.updatedAt,
      description: raw.description,
      extraProperties: raw.extraProperties ?? {},
      actions: raw.actions,
    });
  }

  private pruneDetailCache(alerts: Map<string, AlertDetail>): void {
    for (const id of this.details.keys()) if (!alerts.has(id)) this.details.delete(id);
  }

  /** Team names label responders. Failure is not fatal: ids are shown instead. */
  private async refreshTeams(): Promise<void> {
    try {
      const names = await this.client.listTeams();
      this.teamNames.clear();
      for (const [id, name] of names) this.teamNames.set(id, name);
    } catch (error) {
      log.warn('could not load team names; responders are shown without names', {
        status: error instanceof JiraApiError ? (error.status ?? 'none') : 'none',
      });
    }
  }
}
