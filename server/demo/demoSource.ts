import { HISTORY_MAX_OFFSET, HISTORY_PAGE_SIZE } from '../../shared/history';
import type { AlertDetail, ExtractionRules, HistoryResponse } from '../../shared/types';
import { mapAlert, toListItem, type MapContext } from '../jira/mapper';
import { RawAlertSchema } from '../jira/schemas';
import type { AlertSource, HistoryPage, SourceSnapshot } from '../services/source';
import { buildDemoAlerts, DEMO_TEAMS } from './demoData';

/**
 * Serves sample alerts without contacting Jira. The data is created once at
 * start-up (timestamps are relative to that moment) and passes through the
 * same validation and mapping as live data.
 */
export class DemoSource implements AlertSource {
  readonly mode = 'demo' as const;
  private readonly snapshot: SourceSnapshot;

  constructor(rules: ExtractionRules, extraAlerts = 0, now = Date.now()) {
    const ctx: MapContext = { rules, teamNames: DEMO_TEAMS, alertUrl: () => null };
    const alerts = new Map<string, AlertDetail>();
    let skipped = 0;
    for (const raw of buildDemoAlerts(now, extraAlerts)) {
      const parsed = RawAlertSchema.safeParse(raw);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      alerts.set(parsed.data.id, mapAlert(parsed.data, ctx, true));
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
}
