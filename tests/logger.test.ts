import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, redact } from '../server/logger';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks Basic and Bearer credentials in any letter case', () => {
    for (const scheme of ['Basic', 'basic', 'BEARER', 'Bearer']) {
      for (const token of ['b3BzQGV4YW1wbGUuY29t', 'ABCDEFGHIJ', 'abcdefghij', 'AbC.dE_f-G+h/=']) {
        expect(redact(`Authorization: ${scheme} ${token}`)).toBe(`Authorization: ${scheme}[redacted]`);
      }
    }
    // Too short to be a credential.
    expect(redact('Basic abc')).toBe('Basic abc');
  });

  it('writes the fields after the message, only when there are any', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log.info('sync complete');
    log.info('sync complete', { alerts: 3, kind: 'full', skipped: undefined });
    const [plain, withFields] = out.mock.calls.map((call) => String(call[0]));
    expect(plain).toMatch(/ INFO {2}sync complete$/);
    expect(withFields).toMatch(/ INFO {2}sync complete alerts=3 kind="full"$/);
  });

  it('masks credentials in fields too', () => {
    const out = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log.warn('jira request rejected', { header: 'Bearer abcdefghijkl' });
    expect(String(out.mock.calls[0]?.[0])).toMatch(/header="Bearer\[redacted\]"$/);
  });
});
