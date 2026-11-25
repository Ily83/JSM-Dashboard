import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

/** loadConfig, split into helpers for SonarQube in 0.4.0: each branch it had keeps its result. */

const basic = { JIRA_SITE_URL: 'example.atlassian.net', JIRA_EMAIL: 'ops@example.com', JIRA_API_TOKEN: 'ATATT-example-not-a-real-token' };
const oauth = {
  JIRA_AUTH_MODE: 'oauth',
  JIRA_SITE_URL: 'https://example.atlassian.net',
  JIRA_OAUTH_CLIENT_ID: 'client',
  JIRA_OAUTH_CLIENT_SECRET: 'secret',
};

describe('loadConfig branches', () => {
  it('reports invalid variables by name only', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid configuration:\n {2}PORT: must be an integer between 1 and 65535/);
  });

  it('builds live basic-auth settings with their defaults', () => {
    const config = loadConfig(basic);
    expect(config.mode).toBe('live');
    expect(config.oauth).toBeUndefined();
    expect(config.jira).toMatchObject({
      siteUrl: 'https://example.atlassian.net',
      siteHost: 'example.atlassian.net',
      cloudId: null,
      email: 'ops@example.com',
      apiToken: 'ATATT-example-not-a-real-token',
      alertQuery: null,
      openQuery: 'status: open',
      closedQuery: 'NOT status: open',
      alertUrlTemplate: '{siteUrl}/jira/ops/alerts/{id}',
      enrichDetails: 'auto',
      writeActions: [],
    });
    expect(config.warnings).toEqual([]);
  });

  it('builds OAuth settings without basic credentials, on a loopback callback', () => {
    const config = loadConfig({ ...oauth, PORT: '9000' });
    expect(config.oauth).toEqual({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost:9000/api/auth/callback' });
    expect(config.jira).toMatchObject({ email: '', apiToken: '', siteUrl: 'https://example.atlassian.net' });
    expect(() => loadConfig({ ...oauth, JIRA_SITE_URL: 'http://example.atlassian.net' })).toThrow(/OAuth requires/);
    expect(() => loadConfig({ ...oauth, JIRA_OAUTH_CLIENT_ID: undefined })).toThrow(/OAuth requires/);
    expect(() => loadConfig({ ...oauth, HOST: '0.0.0.0' })).toThrow('OAuth mode requires a loopback HOST.');
    expect(() => loadConfig({ ...oauth, JIRA_OAUTH_REDIRECT_URI: 'http://localhost/api/auth/callback' })).toThrow(/JIRA_OAUTH_REDIRECT_URI/);
  });

  it('falls back to demo mode, with a warning only when the Jira settings are half there', () => {
    expect(loadConfig({}).warnings).toEqual([]);
    expect(loadConfig({ ...basic, DEMO_MODE: 'yes' })).toMatchObject({ mode: 'demo', jira: null, warnings: [] });
    expect(loadConfig({ ...oauth, HOST: '0.0.0.0', DEMO_MODE: 'on' })).toMatchObject({ mode: 'demo', oauth: undefined });
    expect(loadConfig({ JIRA_EMAIL: 'ops@example.com' }).warnings).toEqual([
      'Jira configuration is incomplete (missing JIRA_SITE_URL, JIRA_API_TOKEN). Running in demo mode.',
    ]);
    expect(loadConfig({ ...basic, JIRA_SITE_URL: 'http://example.atlassian.net' })).toMatchObject({
      mode: 'demo',
      warnings: ['JIRA_SITE_URL is not a valid https URL. Running in demo mode.'],
    });
  });

  it('warns about unknown write actions before anything else', () => {
    expect(loadConfig({ JIRA_EMAIL: 'ops@example.com', JIRA_WRITE_ACTIONS: 'acknowledge,bogus' }).warnings).toEqual([
      'JIRA_WRITE_ACTIONS contains unknown actions (bogus). They are ignored.',
      'Jira configuration is incomplete (missing JIRA_SITE_URL, JIRA_API_TOKEN). Running in demo mode.',
    ]);
    expect(loadConfig({ ...basic, JIRA_WRITE_ACTIONS: 'acknowledge' }).jira?.writeActions).toEqual(['acknowledge']);
  });
});
