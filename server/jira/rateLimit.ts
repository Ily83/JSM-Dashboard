const DIAGNOSTIC_HEADERS = [
  'retry-after', 'ratelimit', 'ratelimit-policy', 'ratelimit-reason', 'ratelimit-limit', 'ratelimit-remaining',
  'ratelimit-reset', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-nearlimit', 'x-ratelimit-reason',
  'beta-ratelimit', 'beta-ratelimit-policy', 'beta-ratelimit-reason', 'beta-retry-after',
  'x-beta-ratelimit-limit', 'x-beta-ratelimit-remaining', 'x-beta-ratelimit-reset',
  'x-beta-ratelimit-nearlimit', 'x-beta-ratelimit-reason',
] as const;

function nonnegative(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function retryAfter(value: string | null, now: number): number | undefined {
  const seconds = nonnegative(value);
  if (seconds !== undefined) return seconds * 1000;
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Atlassian's structured headers: "policy";q=100;w=1 or "policy";r=10;t=1. */
function policies(value: string | null) {
  return (value ?? '').split(',').flatMap(entry => {
    const [name, ...fields] = entry.trim().split(';');
    if (!/^"[\w.-]+"$/.test(name)) return [];
    const attributes = new Map(fields.map(field => field.trim().split('=', 2) as [string, string]));
    return [{ name, remaining: nonnegative(attributes.get('r')), quota: nonnegative(attributes.get('q')),
      reset: nonnegative(attributes.get('t')) }];
  });
}

function near(remaining: number | undefined, limit: number | undefined): boolean {
  return remaining !== undefined && (limit ? remaining <= limit * 0.2 : remaining <= 5);
}

export function rateLimitHints(headers: Headers, now: number) {
  const diagnostic: Record<string, string> = {};
  for (const name of DIAGNOSTIC_HEADERS) {
    const value = headers.get(name);
    if (value && /^[\w.:;,"= +\/-]{1,256}$/.test(value)) diagnostic[name] = value;
  }

  const limit = nonnegative(headers.get('x-ratelimit-limit')) ?? nonnegative(headers.get('ratelimit-limit'));
  const remaining = nonnegative(headers.get('x-ratelimit-remaining')) ?? nonnegative(headers.get('ratelimit-remaining'));
  const xReset = headers.get('x-ratelimit-reset');
  const xResetAt = xReset && /^\d{4}-\d{2}-\d{2}T/.test(xReset) ? Date.parse(xReset) : NaN;
  const reset = Number.isFinite(xResetAt)
    ? Math.max(0, xResetAt - now)
    : (nonnegative(headers.get('ratelimit-reset')) ?? 0) * 1000;
  let slowdownMs = headers.get('x-ratelimit-nearlimit')?.toLowerCase() === 'true' || near(remaining, limit) ? reset || 10_000 : 0;
  let exhaustedMs = remaining === 0 ? reset : 0;
  const quotas = new Map(policies(headers.get('ratelimit-policy')).map(policy => [policy.name, policy.quota]));
  for (const policy of policies(headers.get('ratelimit'))) {
    const windowMs = (policy.reset ?? 0) * 1000;
    if (near(policy.remaining, quotas.get(policy.name))) slowdownMs = Math.max(slowdownMs, windowMs || 10_000);
    if (policy.remaining === 0) exhaustedMs = Math.max(exhaustedMs, windowMs);
  }
  return { diagnostic, slowdownMs, exhaustedMs, resetMs: reset, retryAfterMs: retryAfter(headers.get('retry-after'), now) };
}
