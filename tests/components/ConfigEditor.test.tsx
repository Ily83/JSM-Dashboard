// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_FIELDS, type DesktopConfigResponse, type DesktopConfigSaveResponse } from '../../shared/desktopConfig';
import { ConfigEditor } from '../../src/components/ConfigEditor';

function config(values: Record<string, string> = {}, extra: Partial<DesktopConfigResponse> & { secrets?: string[]; locked?: string[] } = {}): DesktopConfigResponse {
  const { secrets = [], locked = [], ...rest } = extra;
  return {
    file: '/apps/alert-center/.env', editable: true, mode: 'demo', oauth: false, callbackUrl: 'http://localhost:8787/api/auth/callback', warnings: [],
    fields: CONFIG_FIELDS.map((field) => ({
      key: field.key,
      value: field.kind === 'secret' ? null : values[field.key] ?? null,
      set: field.kind === 'secret' ? secrets.includes(field.key) : field.key in values,
      locked: locked.includes(field.key),
    })),
    ...rest,
  };
}

/** Renders the editor against a fake backend and records what it saves. */
function setup(initial: DesktopConfigResponse, answer: (values: Record<string, string | null>) => Response = () => Response.json({ ...initial, origin: 'http://localhost:8787' })) {
  const saved: Array<Record<string, string | null>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(initial);
    expect(new Headers(init.headers).get('X-Alert-Center-Action')).toBe('1');
    const { values } = JSON.parse(String(init.body)) as { values: Record<string, string | null> };
    saved.push(values);
    return answer(values);
  }));
  const applied: Array<[DesktopConfigSaveResponse, boolean]> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfigEditor onApplied={(result, standalone) => applied.push([result, standalone])} />
    </QueryClientProvider>,
  );
  return { saved, applied, user: userEvent.setup() };
}

describe('ConfigEditor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the file’s settings, the defaults as hints, and never a secret', async () => {
    setup(config({ JIRA_SITE_URL: 'https://one.atlassian.net', JIRA_AUTH_MODE: 'basic', JIRA_EMAIL: 'ops@example.com' }, { secrets: ['JIRA_API_TOKEN'] }));
    expect(await screen.findByRole('form', { name: 'Configuration file' })).toBeTruthy();
    expect((screen.getByLabelText('Jira site') as HTMLInputElement).value).toBe('https://one.atlassian.net');
    const token = screen.getByLabelText('API token') as HTMLInputElement;
    expect(token.type).toBe('password');
    expect(token.value).toBe('');
    expect(token.placeholder).toBe('Saved');
    expect((screen.getByLabelText('Customer tag prefixes') as HTMLInputElement).placeholder).toBe('customer:, customer=, cust:');
    expect((screen.getByLabelText('Use the entity as service') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('/apps/alert-center/.env')).toBeTruthy();
    // API token sign-in: the OAuth fields are not shown, and nothing can be saved yet.
    expect(screen.queryByLabelText('OAuth client ID')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save and reconnect' }) as HTMLButtonElement).disabled).toBe(true);
    // Write actions and the port are not offered.
    expect(screen.queryByLabelText(/write actions|port/i)).toBeNull();
  });

  it('saves only what changed, and reopens the app at the address the backend names', async () => {
    const { saved, applied, user } = setup(config({ JIRA_SITE_URL: 'https://one.atlassian.net', JIRA_ALERT_QUERY: 'teams: ops' }, { secrets: ['JIRA_API_TOKEN'] }));
    await screen.findByRole('form', { name: 'Configuration file' });
    await user.selectOptions(screen.getByLabelText('Sign-in'), 'oauth');
    expect(screen.queryByLabelText('API token')).toBeNull();
    expect(screen.getByText('http://localhost:8787/api/auth/callback')).toBeTruthy();
    await user.type(screen.getByLabelText('OAuth client ID'), 'client-1');
    await user.type(screen.getByLabelText('OAuth client secret'), 'not-a-real-secret');
    await user.clear(screen.getByLabelText('Extra alert query'));
    await user.click(screen.getByLabelText('Use the entity as service'));
    // Typed and removed again: not a change.
    await user.type(screen.getByLabelText('Open alerts to load'), '5');
    await user.clear(screen.getByLabelText('Open alerts to load'));
    await user.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(saved).toEqual([{
      JIRA_AUTH_MODE: 'oauth', JIRA_OAUTH_CLIENT_ID: 'client-1', JIRA_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
      SERVICE_FALLBACK_TO_ENTITY: 'false', JIRA_ALERT_QUERY: null,
    }]);
    expect(applied[0][0].origin).toBe('http://localhost:8787');
    expect(applied[0][1]).toBe(false);
  });

  it('shows the backend’s refusal and keeps what was typed', async () => {
    const { applied, user } = setup(config(), () => Response.json({ error: 'Enter the API token again to change the Jira site.' }, { status: 400 }));
    await screen.findByRole('form', { name: 'Configuration file' });
    await user.type(screen.getByLabelText('Jira site'), 'https://two.atlassian.net');
    await user.click(screen.getByRole('button', { name: 'Save and reconnect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the API token again to change the Jira site.');
    expect((screen.getByLabelText('Jira site') as HTMLInputElement).value).toBe('https://two.atlassian.net');
    expect(applied).toHaveLength(0);
  });

  it('disables what the environment sets, shows warnings, and warns that saving signs out', async () => {
    const { user } = setup(config({ JIRA_AUTH_MODE: 'oauth', JIRA_SITE_URL: 'https://one.atlassian.net' }, {
      oauth: true, mode: 'live', locked: ['JIRA_SITE_URL'], secrets: ['JIRA_OAUTH_CLIENT_SECRET'], warnings: ['JIRA_WRITE_ACTIONS contains unknown actions (x). They are ignored.'],
    }));
    await screen.findByRole('form', { name: 'Configuration file' });
    const site = screen.getByLabelText('Jira site') as HTMLInputElement;
    expect(site.disabled).toBe(true);
    expect(site.title).toContain('environment');
    expect(screen.getByText(/unknown actions/)).toBeTruthy();
    expect(screen.queryByText('Saving signs you out.')).toBeNull();
    await user.type(screen.getByLabelText('Extra alert query'), 'x');
    expect(screen.getByText('Saving signs you out.')).toBeTruthy();
  });

  it('reports a backend that cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unknown API endpoint.' }, { status: 404 })));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfigEditor /></QueryClientProvider>);
    expect((await screen.findByRole('alert')).textContent).toBe('Unknown API endpoint.');
  });
});
