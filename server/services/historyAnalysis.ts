import { DAY_MS, HISTORY_PAGE_SIZE, utcDate } from '../../shared/history';
import type { HistoryAnalysisStatus, HistoryMonth } from '../../shared/historyAnalysis';
import type { Alert, HistoryResponse } from '../../shared/types';
import { JiraApiError } from '../jira/client';
import type { HistoryPage } from './source';

type FetchPage = (page: HistoryPage) => Promise<HistoryResponse>;
type Job = { status: HistoryAnalysisStatus; months: HistoryMonth[] };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calendar months touched by the inclusive UTC range: one per scanned window of `run`. */
function monthCount(from: number, to: number): number {
  const start = new Date(from);
  const end = new Date(to);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
}

/** One server-local analysis, retained in memory until another is started or the server restarts. */
export class HistoryAnalysisService {
  private job: Job | null = null;

  constructor(private readonly fetchPage: FetchPage, private readonly delayMs = 1000) {}

  status(): HistoryAnalysisStatus | null {
    return this.job ? { ...this.job.status } : null;
  }

  results(id: string): HistoryMonth[] | null {
    return this.job?.status.id === id && this.job.status.state === 'completed' ? this.job.months : null;
  }

  start(from: number, to: number): HistoryAnalysisStatus | null {
    const fromDate = utcDate(from);
    const toDate = utcDate(to);
    if (this.job?.status.state === 'running') {
      return this.job.status.from === fromDate && this.job.status.to === toDate ? this.status() : null;
    }
    if (this.job?.status.state === 'completed' && this.job.status.from === fromDate && this.job.status.to === toDate) return this.status();
    const job: Job = {
      status: {
        id: randomUUID(), from: fromDate, to: toDate, state: 'running', pages: 0, recordsRead: 0,
        monthsDone: 0, monthsTotal: monthCount(from, to), partial: false, message: null,
      },
      months: [],
    };
    this.job = job;
    void this.run(job, from, to);
    return this.status();
  }

  cancel(id: string): HistoryAnalysisStatus | null {
    if (this.job?.status.id !== id) return null;
    if (this.job.status.state === 'running') this.job.status.state = 'cancelled';
    return this.status();
  }

  private active(job: Job): boolean {
    return this.job === job && job.status.state === 'running';
  }

  private async page(job: Job, from: number, until: number, offset: number): Promise<HistoryResponse | null> {
    let failures = 0;
    while (this.active(job)) {
      if (this.delayMs > 0) await delay(this.delayMs);
      if (!this.active(job)) return null;
      try {
        const page = await this.fetchPage({ from, until, offset, background: true });
        if (!this.active(job)) return null;
        job.status.pages += 1;
        job.status.recordsRead += page.alerts.length;
        job.status.message = null;
        return page;
      } catch (error) {
        if (!this.active(job)) return null;
        if (!(error instanceof JiraApiError) || !['rate_limit', 'network', 'server'].includes(error.kind)) throw error;
        failures += 1;
        job.status.message = 'Jira is busy or unavailable; retrying in the background.';
        await delay(Math.max(error.retryAfterMs ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(failures, 6))));
      }
    }
    return null;
  }

  private async scanWindow(job: Job, from: number, until: number, seen: Map<string, Alert>): Promise<boolean> {
    const windowAlerts = new Map<string, Alert>();
    let partial = false;
    for (let offset = 0; this.active(job); offset += HISTORY_PAGE_SIZE) {
      const page = await this.page(job, from, until, offset);
      if (!page) return true;
      if (page.truncated && until - from > 1) {
        const middle = from + Math.floor((until - from) / 2);
        const first = await this.scanWindow(job, from, middle, seen);
        const second = await this.scanWindow(job, middle, until, seen);
        return first || second;
      }
      partial ||= page.truncated || page.skipped > 0;
      for (const alert of page.alerts) {
        if (alert.createdAt < from || alert.createdAt >= until || windowAlerts.has(alert.id)) partial = true;
        else windowAlerts.set(alert.id, alert);
      }
      if (!page.hasNext) break;
    }
    for (const [id, alert] of windowAlerts) {
      if (seen.has(id)) partial = true;
      else seen.set(id, alert);
    }
    return partial;
  }

  private async run(job: Job, from: number, to: number): Promise<void> {
    try {
      for (let start = from; start <= to && this.active(job);) {
        const date = new Date(start);
        const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        const until = Math.min(next, to + DAY_MS);
        const alerts = new Map<string, Alert>();
        const partial = await this.scanWindow(job, start, until, alerts);
        if (!this.active(job)) return;
        job.months.push({ key: utcDate(start).slice(0, 7), from: utcDate(start), to: utcDate(until - DAY_MS), alerts: [...alerts.values()], partial });
        job.status.partial ||= partial;
        job.status.monthsDone = job.months.length;
        start = next;
      }
      if (this.active(job)) job.status.state = 'completed';
    } catch (error) {
      if (!this.active(job)) return;
      job.status.state = 'failed';
      job.status.message = error instanceof JiraApiError ? error.publicMessage : 'Analysis failed. Try again.';
    }
  }
}
import { randomUUID } from 'node:crypto';
