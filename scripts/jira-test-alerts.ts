/**
 * Fills a Jira TEST site with sample alerts, or closes them again.
 *
 *   npm run jira:test-alerts -- create --yes [--count 15]
 *   npm run jira:test-alerts -- close --yes
 *
 * Uses the credentials in .env. Every alert it creates carries the tag
 * "alert-center-test", and `close` touches only open alerts with that tag.
 * The sample content is the fictional demo data. After creating, the script
 * also acknowledges, snoozes, assigns or closes some alerts so that every
 * status appears. Never run it against a production site.
 */
import { loadConfig } from '../server/config';
import { buildDemoAlerts } from '../server/demo/demoData';
import { JiraClient, type CreateAlertBody } from '../server/jira/client';

const TEST_TAG = 'alert-center-test';
const args = process.argv.slice(2);
const command = args[0];
const confirmed = args.includes('--yes');
const countArg = args.indexOf('--count');
const count = countArg >= 0 ? Math.max(1, Math.min(30, Number(args[countArg + 1]) || 15)) : 15;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const config = loadConfig();
if (!config.jira) fail('No Jira connection configured: set JIRA_SITE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env.');
if (command !== 'create' && command !== 'close') fail('Usage: npm run jira:test-alerts -- create|close --yes [--count 15]');
if (!confirmed) {
  fail(`This writes to ${config.jira.siteHost}. Only use a test site. Add --yes to continue.`);
}

const client = new JiraClient(config.jira, 2);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function create(): Promise<void> {
  const me = await client.myself().catch(() => null);
  const samples = buildDemoAlerts(Date.now()).slice(0, count);
  let created = 0;
  for (const raw of samples) {
    const body: CreateAlertBody = {
      // Jira keeps at most 130 characters of the message.
      message: (raw.message ?? 'Test alert').slice(0, 130),
      alias: `${TEST_TAG}-${raw.alias ?? raw.id}`.slice(0, 512),
      description: raw.description ?? undefined,
      tags: [...(raw.tags ?? []), TEST_TAG],
      entity: raw.entity ?? undefined,
      source: 'Alert Center test',
      priority: (raw.priority as CreateAlertBody['priority']) ?? 'P3',
      extraProperties: Object.fromEntries(Object.entries(raw.extraProperties ?? {}).map(([k, v]) => [k, String(v)])),
    };
    const result = await client.createAlert(body);
    if (!result.alertId) {
      console.log(`  created (not confirmed yet): ${body.message.slice(0, 70)}`);
      continue;
    }
    created += 1;
    const id = result.alertId;
    const followUps: string[] = [];
    try {
      if (raw.owner && me) {
        await client.performAction(id, { action: 'assign', accountId: me.accountId });
        followUps.push(`assigned to ${me.displayName}`);
      }
      if (raw.status === 'acked') {
        await client.performAction(id, { action: 'acknowledge' });
        followUps.push('acknowledged');
      } else if (raw.status === 'snoozed') {
        await client.performAction(id, { action: 'snooze', endTime: new Date(Date.now() + 4 * 3_600_000).toISOString() });
        followUps.push('snoozed 4 h');
      } else if (raw.status === 'closed') {
        await client.performAction(id, { action: 'close' });
        followUps.push('closed');
      }
    } catch (error) {
      followUps.push(`follow-up failed: ${error instanceof Error ? error.message : 'error'}`);
    }
    console.log(`  ${body.priority} ${body.message.slice(0, 70)}${followUps.length ? `  [${followUps.join(', ')}]` : ''}`);
    await sleep(150);
  }
  console.log(`${created} of ${samples.length} test alerts created on ${config.jira!.siteHost}.`);
}

async function close(): Promise<void> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await client.listAlerts({ query: `tag: ${TEST_TAG} AND status: open`, offset, size: 100 });
    ids.push(...page.alerts.map((a) => a.id));
    if (!page.hasNext || page.alerts.length === 0) break;
  }
  let closed = 0;
  for (const id of ids) {
    try {
      await client.performAction(id, { action: 'close' });
      closed += 1;
    } catch (error) {
      console.log(`  ${id}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  console.log(`${closed} of ${ids.length} open test alerts closed on ${config.jira!.siteHost}.`);
}

try {
  await (command === 'create' ? create() : close());
} catch (error) {
  fail(error instanceof Error ? error.message : 'Failed.');
}
