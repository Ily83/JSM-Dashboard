import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_FIELDS } from '../shared/desktopConfig';
import { loadConfig } from '../server/config';
import { EnvFileError, formatEnvValue, parseEnvText, readEnvText, updateEnvText, writeEnvText } from '../server/envFile';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'envfile-')); dirs.push(dir); return dir; };

const FILE = `# Jira
JIRA_SITE_URL=https://old.atlassian.net
# JIRA_AUTH_MODE=oauth
# JIRA_OAUTH_CLIENT_ID=

# Extra query
JIRA_ALERT_QUERY=
PORT=8787
`;

describe('updateEnvText', () => {
  it('changes a setting in place and keeps every other line', () => {
    const next = updateEnvText(FILE, { JIRA_SITE_URL: 'https://new.atlassian.net' });
    expect(next).toBe(FILE.replace('https://old.atlassian.net', 'https://new.atlassian.net'));
  });

  it('puts a new setting below its commented example, else at the end', () => {
    const next = updateEnvText(FILE, { JIRA_AUTH_MODE: 'oauth', CUSTOMER_MAP_FILE: 'customers.csv' });
    const lines = next.split('\n');
    expect(lines[lines.indexOf('# JIRA_AUTH_MODE=oauth') + 1]).toBe('JIRA_AUTH_MODE=oauth');
    expect(lines.at(-2)).toBe('CUSTOMER_MAP_FILE=customers.csv');
    expect(next.endsWith('\n')).toBe(true);
  });

  it('removes a setting, including duplicates, and leaves its example comment', () => {
    const next = updateEnvText(`${FILE}PORT=9000\n`, { PORT: null, JIRA_OAUTH_CLIENT_ID: null });
    expect(parseEnvText(next).PORT).toBeUndefined();
    expect(next).toContain('# JIRA_OAUTH_CLIENT_ID=');
  });

  it('replaces duplicates by one line, so the new value is the one read', () => {
    const next = updateEnvText('A=1\nB=2\nA=3\n', { A: '4' });
    expect(next).toBe('A=4\nB=2\n');
  });

  it('keeps Windows line endings', () => {
    const next = updateEnvText('A=1\r\nB=2\r\n', { B: '3', C: '4' });
    expect(next).toBe('A=1\r\nB=3\r\nC=4\r\n');
  });

  it('starts a file that does not exist yet', () => {
    expect(updateEnvText('', { JIRA_SITE_URL: 'https://x.atlassian.net' })).toBe('JIRA_SITE_URL=https://x.atlassian.net\n');
  });

  it('quotes values so that they read back exactly', () => {
    const values = {
      A: 'teams: "Cloud Operations"', B: "it's # not a comment", C: ' padded ', D: 'tag:a, tag=b', E: '{siteUrl}/jira/ops/alerts/{id}',
      F: 'both \' and " quotes', G: 'back\\slash', H: '$HOME',
    };
    expect(parseEnvText(updateEnvText('', values))).toEqual(values);
  });

  it('refuses line breaks, values it cannot quote and invalid names', () => {
    expect(() => formatEnvValue('a\nb')).toThrow(EnvFileError);
    expect(() => formatEnvValue('\' " `')).toThrow(EnvFileError);
    expect(() => updateEnvText('', { 'BAD KEY': 'x' })).toThrow(EnvFileError);
  });

  it('refuses an update that would change another setting', () => {
    // The multi-line value hides a line that looks like the setting to change.
    const tricky = 'NOTE="first\nJIRA_SITE_URL=inside the note"\nJIRA_SITE_URL=https://old.atlassian.net\n';
    expect(() => updateEnvText(tricky, { JIRA_SITE_URL: 'https://new.atlassian.net' })).toThrow('could not be updated safely');
  });
});

describe('readEnvText and writeEnvText', () => {
  it('reads a missing file as empty and writes a private file in one step', () => {
    const file = path.join(tempDir(), '.env');
    expect(readEnvText(file)).toBe('');
    writeEnvText(file, 'A=1\n');
    expect(readFileSync(file, 'utf8')).toBe('A=1\n');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileSync(file, 'A=2\n');
    writeEnvText(file, 'A=3\n');
    expect(readEnvText(file)).toBe('A=3\n');
  });

  it('reports a folder that cannot be written', () => {
    expect(() => writeEnvText(path.join(tempDir(), 'missing', '.env'), 'A=1\n')).toThrow('Could not write the configuration file');
  });
});

describe('editable settings', () => {
  it('show the same defaults as the configuration uses', () => {
    const config = loadConfig({});
    const fallback = (key: string) => CONFIG_FIELDS.find((field) => field.key === key)?.fallback;
    const list = (key: string) => (fallback(key) ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    expect(list('CUSTOMER_TAG_PREFIXES')).toEqual(config.extraction.customerTagPrefixes);
    expect(list('CUSTOMER_PROPERTY_KEYS')).toEqual(config.extraction.customerPropertyKeys);
    expect(list('SERVICE_TAG_PREFIXES')).toEqual(config.extraction.serviceTagPrefixes);
    expect(list('SERVICE_PROPERTY_KEYS')).toEqual(config.extraction.servicePropertyKeys);
    expect(fallback('SERVICE_FALLBACK_TO_ENTITY')).toBe(String(config.extraction.serviceFallbackToEntity));
    const live = loadConfig({ JIRA_SITE_URL: 'https://x.atlassian.net', JIRA_EMAIL: 'ops@example.com', JIRA_API_TOKEN: 'not-a-real-token' }).jira!;
    expect(fallback('JIRA_OPEN_QUERY')).toBe(live.openQuery);
    expect(fallback('JIRA_CLOSED_QUERY')).toBe(live.closedQuery);
    expect(fallback('JIRA_MAX_ALERTS')).toBe(String(live.maxOpenAlerts));
    expect(fallback('JIRA_MAX_CLOSED_ALERTS')).toBe(String(live.maxClosedAlerts));
    expect(fallback('JIRA_CLOSED_LOOKBACK_HOURS')).toBe(String(live.closedLookbackHours));
    expect(fallback('JIRA_ALERT_URL_TEMPLATE')).toBe(live.alertUrlTemplate);
  });

  it('never include write actions, the port, the host or the OAuth callback', () => {
    const keys = CONFIG_FIELDS.map((field) => field.key);
    for (const key of ['JIRA_WRITE_ACTIONS', 'PORT', 'HOST', 'ALLOWED_HOSTS', 'JIRA_OAUTH_REDIRECT_URI']) expect(keys).not.toContain(key);
  });
});
