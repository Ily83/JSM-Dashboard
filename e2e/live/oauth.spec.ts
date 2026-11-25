import { existsSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { ActionId, ActionResult, AlertAttachment, AlertLogEntry, AlertNote, DirectoryUser, Page as Listing } from '../../shared/actions';
import type { Maintenance, MaintenancesResponse, MaintenanceTargetsResponse } from '../../shared/opsContext';
import type { Alert, AlertDetail, AlertsResponse, StatusResponse } from '../../shared/types';
import { apiWrite, expect, panel, rows, test } from '../fixtures';
import { SESSION_FILE, SESSION_FILE_LABEL, SESSION_TTL_MS, liveUrl, localEnv, sessionAgeMinutes } from './oauthSession';

/**
 * Live checks through an Alert Center that signs in with Atlassian OAuth.
 *
 * OAuth sessions live only in the memory of the server the operator signed in
 * to, so these tests never start a server: they use that instance
 * (E2E_LIVE_URL, default the origin of JIRA_OAUTH_REDIRECT_URI) with the
 * sign-in saved by `npm run e2e:live:login`.
 *
 * They act on ONE alert only: an open alert tagged TAG that the operator
 * created for this purpose, through the app's UI and its API, and read the
 * results back through the app's API. Each test puts the alert back where it
 * can; what cannot be undone is recorded in an annotation ("restore").
 */

const TAG = 'alert-center-oauth-e2e';
const run = Date.now().toString(36);
const LOGIN = 'npm run e2e:live:login';

interface ActionResponse {
  result: ActionResult;
  alert: AlertDetail | null;
  error?: string;
}

const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/** Skips every test in the file. The list reporter hides skip reasons, so it is printed too. */
function skipAll(reason: string): never {
  console.log(`live-oauth skipped: ${reason}`);
  test.skip(true, reason);
  throw new Error(reason); // not reached: test.skip ends the hook
}

function outcome(label: string, result: ActionResult) {
  note('Jira outcome', `${label}: ${result.message ?? (result.state === 'done' ? 'done (no text from Jira)' : 'sent, not confirmed by Jira yet')}`);
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  expect(response.status(), `GET ${path} ${body?.error ?? ''}`).toBe(200);
  return body as T;
}

/** The alert as listed after a forced synchronisation (the backend caches). */
async function freshAlert(page: Page, id: string): Promise<Alert | undefined> {
  return (await getJson<AlertsResponse>(page, '/api/alerts?refresh=1')).alerts.find((a) => a.id === id);
}

/** Polls the app's API until Jira reports the expected state. Forced refreshes are at least 5 s apart. */
async function until(page: Page, id: string, what: string, check: (alert: Alert) => boolean): Promise<Alert> {
  let last: Alert | undefined;
  await expect
    .poll(
      async () => {
        last = await freshAlert(page, id);
        return last !== undefined && check(last);
      },
      { message: `Jira did not report: ${what}`, timeout: 60_000, intervals: [1000, 5000] },
    )
    .toBe(true);
  return last!;
}

/** Runs one UI step that sends an alert action and returns Jira's answer to it. */
async function viaUi(page: Page, id: string, label: string, trigger: () => Promise<void>): Promise<ActionResult> {
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/alerts/${encodeURIComponent(id)}/actions`,
    { timeout: 60_000 },
  );
  await trigger();
  const response = await answer;
  const body = (await response.json().catch(() => ({}))) as ActionResponse;
  expect(response.status(), `${label}: ${body.error ?? ''}`).toBe(200);
  outcome(label, body.result);
  return body.result;
}

/** Sends one alert action through the app's API, as the UI does. */
async function viaApi(page: Page, id: string, label: string, action: Record<string, unknown>): Promise<ActionResult> {
  const { status, body } = await apiWrite<ActionResponse>(page, `/api/alerts/${encodeURIComponent(id)}/actions`, action);
  expect(status, `${label}: ${body?.error ?? ''}`).toBe(200);
  outcome(label, body.result);
  return body.result;
}

const notes = async (page: Page, id: string) =>
  (await getJson<Listing<AlertNote>>(page, `/api/alerts/${encodeURIComponent(id)}/notes`)).values.map((n) => n.note);

test.describe.serial('live OAuth', () => {
  // Every step waits for Jira and reads the result back.
  test.describe.configure({ timeout: 240_000 });

  let base = '';
  let status: StatusResponse;
  let target: Alert;
  const enabled = (...actions: ActionId[]) => actions.every((a) => status.writes.actions.includes(a));
  const disabled = (...actions: ActionId[]) =>
    `needs ${actions.join(' and ')} in JIRA_WRITE_ACTIONS of the instance (and the matching scopes when signing in)`;

  /** Opens the test alert's panel, reloading when it is already open so it shows what the backend has now. */
  async function openAlert(page: Page): Promise<Locator> {
    const path = `/#/active?alert=${encodeURIComponent(target.id)}`;
    // The same URL again would only be a hash change, keeping the page's cached data.
    if (page.url() === new URL(path, base).href) await page.reload();
    else await page.goto(path);
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText(target.summary);
    return p;
  }

  test.beforeAll(async ({ playwright }, info) => {
    // Reports an invalid E2E_LIVE_URL; playwright.config.ts leaves baseURL unset then.
    base = info.project.use.baseURL ?? liveUrl(localEnv());
    if (!existsSync(SESSION_FILE)) skipAll(`No saved OAuth sign-in (${SESSION_FILE_LABEL}). Start the instance at ${base}, then run ${LOGIN}.`);
    const api = await playwright.request.newContext({ baseURL: base, storageState: SESSION_FILE });
    try {
      const answer = await api.get('/api/status', { maxRedirects: 0, timeout: 15_000 }).catch(() => null);
      if (!answer) throw new Error(`No Alert Center answers at ${base}. Start the instance you signed in to, or set E2E_LIVE_URL to its address.`);
      if (answer.status() === 401) {
        skipAll(`The instance at ${base} is signed out: it restarted, the 8-hour session ended, or someone signed in elsewhere. Run ${LOGIN} again.`);
      }
      if (answer.status() === 403) {
        throw new Error(`${base} refused the request (${(await answer.text()).slice(0, 200)}). Set E2E_LIVE_URL to the address in JIRA_OAUTH_REDIRECT_URI.`);
      }
      expect(answer.status(), `GET ${base}/api/status`).toBe(200);
      status = (await answer.json()) as StatusResponse;
      if (status.mode !== 'live' || !status.oauth) {
        skipAll(`${base} is not a live instance signed in with Atlassian (mode ${status.mode}, OAuth ${status.oauth ? 'on' : 'off'}). The API-token round trip is npm run e2e:live.`);
      }

      const list = await api.get('/api/alerts?refresh=1', { timeout: 60_000 });
      expect(list.status(), 'GET /api/alerts').toBe(200);
      // Newest first, as the backend sorts them.
      const candidates = ((await list.json()) as AlertsResponse).alerts.filter((a) => a.status !== 'closed' && a.tags.includes(TAG));
      if (candidates.length === 0) {
        skipAll(`No open alert tagged ${TAG} on ${status.site}. Create one disposable test alert with that tag (and nothing else depending on it), then run again.`);
      }
      target = candidates[0];
    } finally {
      await api.dispose();
    }
  });

  test('signed in: status and the alert list load', async ({ page }) => {
    await page.goto('/#/active');
    const current = await getJson<StatusResponse>(page, '/api/status');
    expect(current.oauth).toBe(true);
    expect(current.mode).toBe('live');
    note('instance', `${base} signed in to ${current.site}; writes enabled: ${current.writes.actions.join(', ') || 'none (read-only)'}`);
    note('test alert', `${target.tinyId ? `#${target.tinyId} ` : ''}${target.summary} (${target.id})`);
    const age = sessionAgeMinutes(base);
    if (age !== null) note('session age', `${age} min since sign-in`);

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const p = await openAlert(page);
    await expect(p).toContainText(TAG);
  });

  test('acknowledge, then unacknowledge', async ({ page }) => {
    test.skip(!enabled('acknowledge', 'unacknowledge'), disabled('acknowledge', 'unacknowledge'));
    await page.goto('/#/active');
    const before = (await freshAlert(page, target.id))!;
    // Toggle away from the current state and back, so the alert ends as it started.
    const steps = before.acknowledged ? (['Unacknowledge', 'Acknowledge'] as const) : (['Acknowledge', 'Unacknowledge'] as const);
    for (const label of steps) {
      // Reopened each time, so the panel shows the state Jira reported.
      const p = await openAlert(page);
      await viaUi(page, target.id, label, () => p.getByRole('button', { name: label, exact: true }).click());
      const acked = label === 'Acknowledge';
      await until(page, target.id, acked ? 'acknowledged' : 'unacknowledged', (a) => a.acknowledged === acked);
    }

    const log = await getJson<Listing<AlertLogEntry>>(page, `/api/alerts/${encodeURIComponent(target.id)}/logs`);
    note('activity log', `${log.values.length}${log.hasMore ? '+' : ''} entries; newest: ${log.values[0]?.text ?? '(none)'}`);
    note('restore', `acknowledged is ${before.acknowledged} again, as before the test`);
  });

  test('add a note, edit it, delete it', async ({ page }) => {
    test.skip(!enabled('addNote'), disabled('addNote'));
    let p = await openAlert(page);
    const text = `Note from the OAuth e2e run ${run}`;
    await p.getByRole('textbox', { name: 'New note' }).fill(text);
    await viaUi(page, target.id, 'add note', () => p.getByRole('button', { name: 'Add note' }).click());
    await expect.poll(() => notes(page, target.id), { message: 'note listed by Jira', timeout: 60_000, intervals: [2000] }).toContain(text);
    let current = text;

    if (enabled('editNote')) {
      const edited = `Edited note from the OAuth e2e run ${run}`;
      p = await openAlert(page);
      await p.locator('li', { hasText: current }).getByRole('button', { name: 'Edit note', exact: true }).click();
      await p.getByRole('textbox', { name: 'Edit note text' }).fill(edited);
      await viaUi(page, target.id, 'edit note', () => p.getByRole('button', { name: 'Save note' }).click());
      await expect.poll(() => notes(page, target.id), { message: 'edited note listed by Jira', timeout: 60_000, intervals: [2000] }).toContain(edited);
      current = edited;
    } else note('skipped', disabled('editNote'));

    if (enabled('deleteNote')) {
      p = await openAlert(page);
      await p.locator('li', { hasText: current }).getByRole('button', { name: 'Delete note', exact: true }).click();
      await viaUi(page, target.id, 'delete note', () => p.getByRole('button', { name: 'Confirm delete note' }).click());
      await expect.poll(() => notes(page, target.id), { message: 'note removed in Jira', timeout: 60_000, intervals: [2000] }).not.toContain(current);
      note('restore', 'the note was deleted');
    } else note('restore', `the note stays on the alert: ${disabled('deleteNote')} (scope delete:ops-alert)`);
  });

  test('add a tag, then remove it', async ({ page }) => {
    test.skip(!enabled('addTags'), disabled('addTags'));
    const p = await openAlert(page);
    const tag = `e2e-oauth-${run}`;
    await p.getByRole('button', { name: 'Add tags' }).click();
    const box = p.getByRole('textbox', { name: /New tags/ });
    await box.fill(tag);
    await viaUi(page, target.id, 'add tag', () => box.press('Enter'));
    await until(page, target.id, `tag ${tag} added`, (a) => a.tags.includes(tag));
    const reopened = await openAlert(page);
    await expect(reopened.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible({ timeout: 30_000 });

    if (enabled('removeTags')) {
      await viaUi(page, target.id, 'remove tag', () => reopened.getByRole('button', { name: `Remove tag ${tag}` }).click());
      await until(page, target.id, `tag ${tag} removed`, (a) => !a.tags.includes(tag));
      note('restore', 'the tag was removed');
    } else note('restore', `tag ${tag} stays on the alert: ${disabled('removeTags')} (scope delete:ops-alert)`);
  });

  test('assign to the signed-in user', async ({ page }) => {
    test.skip(!enabled('assign'), disabled('assign'));
    const p = await openAlert(page);
    const me = await getJson<DirectoryUser | null>(page, '/api/directory/me');
    expect(me, 'the signed-in Atlassian account (scope read:jira-user)').toBeTruthy();
    const before = (await freshAlert(page, target.id))!;

    await p.getByRole('button', { name: 'Assign', exact: true }).click();
    await viaUi(page, target.id, 'assign to me', () => page.getByRole('dialog', { name: 'Assign' }).getByRole('button', { name: /Assign to me/ }).click());
    const after = await until(page, target.id, `owner is ${me!.displayName}`, (a) => a.assignee !== null && [me!.displayName, me!.accountId].includes(a.assignee));
    note('owner', `${after.assignee} (was ${before.assignee ?? 'nobody'})`);
    note('restore', before.assignee && before.assignee !== after.assignee
      ? `not restored: the owner was ${before.assignee}; reassign in Jira if that matters`
      : 'nothing to restore (no other owner before)');
  });

  test('snooze for 5 minutes', async ({ page }) => {
    test.skip(!enabled('snooze'), disabled('snooze'));
    await openAlert(page);
    const before = (await freshAlert(page, target.id))!;
    const endTime = new Date(Date.now() + 5 * 60_000).toISOString();
    await viaApi(page, target.id, 'snooze 5 min', { action: 'snooze', endTime });
    const snoozed = await until(page, target.id, 'snoozed', (a) => a.status === 'snoozed' || (a.snoozedUntil ?? 0) > Date.now());
    note('snoozed until', snoozed.snoozedUntil ? new Date(snoozed.snoozedUntil).toISOString() : '(no end time reported)');
    const p = await openAlert(page);
    await expect(p.locator('header').getByText('Snoozed', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Jira has no "unsnooze". Toggling acknowledgement and back may end the snooze; the ack state ends as it started.
    if (enabled('acknowledge', 'unacknowledge')) {
      for (const action of before.acknowledged ? (['unacknowledge', 'acknowledge'] as const) : (['acknowledge', 'unacknowledge'] as const)) {
        await viaApi(page, target.id, `${action} (to end the snooze)`, { action });
        await until(page, target.id, action === 'acknowledge' ? 'acknowledged' : 'unacknowledged', (a) => a.acknowledged === (action === 'acknowledge'));
      }
    }
    const after = (await freshAlert(page, target.id))!;
    const wakes = after.snoozedUntil ?? 0;
    note('restore', after.status === 'snoozed' || wakes > Date.now()
      ? `still snoozed${wakes ? ` until ${new Date(wakes).toISOString()}` : ''}; it wakes up by itself after 5 minutes`
      : 'no longer snoozed');
  });

  test('upload a text attachment, list it and get its download link', async ({ page }) => {
    test.skip(!enabled('uploadAttachment'), disabled('uploadAttachment'));
    const p = await openAlert(page);
    const name = `alert-center-e2e-${run}.txt`;
    await p.getByRole('button', { name: 'Attachments', exact: true }).click();
    await p.getByLabel('File to attach').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`Alert Center OAuth e2e run ${run}\n`) });
    const uploaded = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/alerts/${encodeURIComponent(target.id)}/attachments`,
      { timeout: 60_000 },
    );
    await p.getByRole('button', { name: 'Upload attachment' }).click();
    const answer = await uploaded;
    expect(answer.status(), `upload: ${((await answer.json().catch(() => ({}))) as { error?: string }).error ?? ''}`).toBe(201);
    await expect(p.getByRole('button', { name })).toBeVisible({ timeout: 30_000 });

    let attachment: AlertAttachment | undefined;
    await expect
      .poll(
        async () => {
          attachment = (await getJson<Listing<AlertAttachment>>(page, `/api/alerts/${encodeURIComponent(target.id)}/attachments`)).values.find((a) => a.name === name);
          return attachment !== undefined;
        },
        { message: 'attachment listed by Jira', timeout: 60_000, intervals: [2000] },
      )
      .toBe(true);
    // The link is fetched, never opened. Only its host is recorded: the URL itself may carry a token.
    const link = await getJson<{ url: string }>(page, `/api/alerts/${encodeURIComponent(target.id)}/attachments/${encodeURIComponent(attachment!.id)}`);
    expect(link.url).toMatch(/^https:\/\//);
    note('attachment', `${name} uploaded and listed; download link from ${new URL(link.url).host} (not opened)`);
    note('restore', 'the attachment stays on the alert: the app cannot delete attachments');
  });

  test('create a 15-minute global maintenance window, see it, cancel it', async ({ page }) => {
    test.skip(!enabled('maintenance'), `${disabled('maintenance')} (scope write:ops-config)`);
    await page.goto('/#/active');
    // A maintenance always switches something. This one only restates a global policy's current
    // state, so nothing changes; it never switches off an integration.
    const { targets } = await getJson<MaintenanceTargetsResponse>(page, '/api/ops/maintenance-targets');
    const policy = targets.find((t) => t.type === 'policy' && t.teamId === null && t.enabled !== null);
    test.skip(!policy, 'No global alert policy with a known state on the site. This test never switches off an integration; add a global alert policy to run it.');
    const state = policy!.enabled ? 'enabled' : 'disabled';

    const now = Date.now();
    const created = await apiWrite<Maintenance & { error?: string }>(page, '/api/maintenances', {
      description: `Alert Center e2e ${run}: changes nothing, cancelled at once`,
      startDate: new Date(now).toISOString(),
      endDate: new Date(now + 15 * 60_000).toISOString(),
      teamId: null,
      rules: [{ entity: { id: policy!.id, type: 'policy' }, state }],
    });
    expect(created.status, `create maintenance: ${created.body?.error ?? ''}`).toBe(201);
    const id = created.body.id;
    note('maintenance', `created ${id} (${created.body.status}), 15 min, keeps policy "${policy!.name}" ${state}`);
    const listed = async () => (await getJson<MaintenancesResponse>(page, '/api/ops/maintenances')).maintenances.find((m) => m.id === id);
    try {
      await expect.poll(async () => (await listed()) !== undefined, { message: 'maintenance listed', timeout: 60_000, intervals: [2000, 5000] }).toBe(true);
    } finally {
      const cancelled = await apiWrite<Maintenance & { error?: string }>(page, `/api/maintenances/${encodeURIComponent(id)}/cancel`, { teamId: null });
      expect(cancelled.status, `cancel maintenance ${id}: ${cancelled.body?.error ?? ''}`).toBe(200);
      note('Jira outcome', `cancel maintenance: ${cancelled.body.status}`);
    }
    await expect
      .poll(async () => {
        const m = await listed();
        return m === undefined || m.status === 'cancelled' || m.status === 'past';
      }, { message: 'maintenance no longer active', timeout: 60_000, intervals: [2000, 5000] })
      .toBe(true);
    note('restore', 'the maintenance was cancelled');
  });

  test('token refresh: reads still work after the access token expired', async ({ page }) => {
    await page.goto('/#/active');
    // Every request makes the backend refresh an expired access token first; a failed refresh signs out (401).
    const current = await getJson<StatusResponse>(page, '/api/status');
    expect(current.oauth).toBe(true);
    // Notes are read from Jira on every request, so this proves Jira accepts the current token.
    await notes(page, target.id);
    const detail = await getJson<AlertDetail>(page, `/api/alerts/${encodeURIComponent(target.id)}`);
    expect(detail.id).toBe(target.id);

    const age = sessionAgeMinutes(base);
    note('session age', age === null ? 'unknown: no session cookie expiry in the saved file' : `${age} min since sign-in`);
    // Atlassian access tokens last one hour. That cannot be forced, only waited for.
    const rerun = 'npm run e2e:live:oauth -- -g "token refresh"';
    const hours = SESSION_TTL_MS / 3_600_000;
    let wait: string | null = null;
    if (age === null) wait = `The sign-in time is unknown (no session cookie expiry in ${SESSION_FILE_LABEL}). Sign in again with ${LOGIN}; after an hour, run: ${rerun}`;
    else if (age < 61) {
      const due = new Date(Date.now() + (61 - age) * 60_000).toLocaleTimeString();
      wait = `Signed in ${age} min ago, so the access token has not expired yet and no refresh was exercised. After ${due}, and within ${hours} h of signing in, run: ${rerun}`;
    }
    if (wait) {
      console.log(`live-oauth: ${wait}`);
      test.skip(true, wait);
    }
    note('token refresh', `the session is over an hour old and status, notes and alert detail still answered: the backend refreshed the access token`);
  });
});
