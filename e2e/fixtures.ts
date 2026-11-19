import { expect, test as base, type Page } from '@playwright/test';

/**
 * Every test fails if the page logs an error or a warning, or throws.
 * Expected refusals (a 403 for attachments on some plans) can be allowed
 * per test with `allowConsole`.
 */
export const test = base.extend<{ allowConsole: RegExp[]; consoleGuard: void }>({
  allowConsole: [[], { option: true }],
  consoleGuard: [
    async ({ page, allowConsole }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !allowConsole.some((r) => r.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
      await use();
      expect(problems, 'console errors or warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const panel = (page: Page) => page.locator('aside[aria-label="Alert details"]');
export const rows = (page: Page) => page.locator('.at-row:not([data-group]):not([data-lane])');
export const search = (page: Page) => page.getByRole('searchbox').first();

/** Sends one write action through the application's own API, as the UI does. */
export async function apiAction(page: Page, alertId: string, action: Record<string, unknown>): Promise<number> {
  return page.evaluate(
    async ({ id, body }) =>
      (await fetch(`/api/alerts/${encodeURIComponent(id)}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-alert-center-action': '1' },
        body: JSON.stringify(body),
      })).status,
    { id: alertId, body: action },
  );
}

export interface ListedAlert {
  id: string;
  tinyId: string | null;
  summary: string;
  priority: string;
  status: string;
  acknowledged: boolean;
  customers: string[];
}

export async function listAlerts(page: Page): Promise<ListedAlert[]> {
  return page.evaluate(async () => ((await (await fetch('/api/alerts')).json()) as { alerts: ListedAlert[] }).alerts);
}

/**
 * Records desktop notifications and alarm tones instead of handing them to
 * the operating system. Call before page.goto().
 */
export async function recordAlarms(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: Array<{ title: string; options: NotificationOptions; onclick: (() => void) | null }>; __tones: number };
    w.__notes = [];
    w.__tones = 0;
    class FakeNotification {
      onclick: (() => void) | null = null;
      constructor(
        public title: string,
        public options: NotificationOptions,
      ) {
        w.__notes.push(this);
      }
      close() {}
      static get permission() {
        return 'granted';
      }
      static requestPermission() {
        return Promise.resolve('granted');
      }
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__tones += 1;
      return create.call(this);
    };
  });
}

export async function alarms(page: Page): Promise<{ titles: string[]; tones: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __notes: Array<{ title: string }>; __tones: number };
    return { titles: w.__notes.map((n) => n.title), tones: w.__tones };
  });
}
