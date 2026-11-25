import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/config';
import { JiraClient } from '../server/jira/client';
import { JiraSource } from '../server/jira/source';
import { setLogLevel } from '../server/logger';
import { HistoryAnalysisService } from '../server/services/historyAnalysis';
import { historyDateLimits, parseUtcDate } from '../shared/history';

const MAX_REQUESTS = 300;
const MAX_MS = 10 * 60_000;
const usage = 'Usage: npm run jira:validate-history -- --test-site https://YOUR-TEST-SITE.atlassian.net --from YYYY-MM-DD --to YYYY-MM-DD --expected COUNT';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function options() {
  try {
    return parseArgs({ args: process.argv.slice(2), options: {
      'test-site': { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      expected: { type: 'string' },
    } }).values;
  } catch {
    fail(usage);
  }
}

const args = options();
const site = args['test-site'];
const from = parseUtcDate(args.from);
const to = parseUtcDate(args.to);
const expected = Number(args.expected);
const { earliest, today } = historyDateLimits(Date.now());
if (!site || !/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(site) || from === null || to === null ||
    from < parseUtcDate(earliest)! || to >= parseUtcDate(today)! || from > to ||
    !Number.isSafeInteger(expected) || expected <= 500) {
  fail(`${usage}\nUse a completed UTC date range in the past year and an independent count above 500.`);
}

function settings() {
  try { return loadConfig(); }
  catch { fail('Could not load Jira configuration. Check the local environment settings.'); }
}

const config = settings();
if (config.jira?.siteUrl !== site || config.oauth) {
  fail('The confirmed test site must match JIRA_SITE_URL exactly. Use test-site API-token credentials for this read-only check.');
}
// Discover the tenant from the confirmed site; do not trust a cloud ID left in .env.
const jira = { ...config.jira, cloudId: null, writeActions: [] };
setLogLevel('error');
let requests = 0;
let rateLimited = 0;
let maxRetryAfterSeconds = 0;
let budgetExceeded = false;
const readOnlyFetch: typeof fetch = async (input, init) => {
  if (init?.method !== 'GET') return new Response(null, { status: 400 });
  if (requests >= MAX_REQUESTS) {
    budgetExceeded = true;
    return new Response(null, { status: 400 });
  }
  requests++;
  // Do not let even the unauthenticated tenant lookup follow a redirect.
  const response = await fetch(input, { ...init, redirect: 'error' });
  if (response.status === 429) {
    rateLimited++;
    const header = response.headers.get('retry-after');
    const seconds = Number(header);
    const duration = Number.isFinite(seconds) ? seconds : Math.ceil((Date.parse(header ?? '') - Date.now()) / 1000);
    if (Number.isFinite(duration)) maxRetryAfterSeconds = Math.max(maxRetryAfterSeconds, duration);
  }
  return response;
};
const source = new JiraSource(jira, config.extraction, new JiraClient(jira, 1, readOnlyFetch));
const analysis = new HistoryAnalysisService(page => source.loadHistory(page));
const started = Date.now();
const job = analysis.start(from, to)!;
const deadline = setTimeout(() => {
  analysis.cancel(job.id);
  report('Timed out', null);
}, MAX_MS);

function report(outcome: string, actual: number | null) {
  const status = analysis.status()!;
  const code = outcome === 'Passed' ? 0 : 1;
  const output = {
    outcome, expected, actual, partial: status.partial, monthsDone: status.monthsDone,
    pages: status.pages, recordsRead: status.recordsRead, requests, rateLimited, maxRetryAfterSeconds,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  // A cancelled retry may still have a long backoff timer waiting.
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`, () => process.exit(code));
}

while (analysis.status()?.state === 'running') await delay(250);
clearTimeout(deadline);
const status = analysis.status()!;
if (status.state === 'completed') {
  const actual = analysis.results(job.id)!.reduce((count, month) => count + month.alerts.length, 0);
  let outcome = 'Passed';
  if (status.partial) outcome = 'Partial result';
  else if (actual !== expected) outcome = 'Count mismatch';
  report(outcome, actual);
} else if (status.state !== 'cancelled') {
  report(budgetExceeded ? 'Request budget exceeded' : `Scan failed: ${status.message ?? 'unknown error'}`, null);
}
