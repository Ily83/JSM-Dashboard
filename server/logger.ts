/**
 * Minimal logger. Call sites pass short, fixed messages plus a few safe
 * fields (status codes, counts, durations). Request headers, response bodies,
 * alert content and credentials are never passed in, and values that look
 * like credentials are masked as a second line of defence.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';

export function setLogLevel(level: Level): void {
  threshold = level;
}

const SECRET_PATTERNS: RegExp[] = [
  /(Basic|Bearer)\s+[a-z0-9+/=._-]{8,}/gi, // case-insensitive: the class covers A-Z too
  /ATATT[A-Za-z0-9+/=._-]{10,}/g, // Atlassian API token prefix
  /([?&](?:token|api[_-]?key|password|secret)=)[^&\s]+/gi,
];

export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_m, keep) => `${typeof keep === 'string' ? keep : ''}[redacted]`);
  }
  return out;
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const extras = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
        .join(' ')
    : '';
  const suffix = extras ? ` ${extras}` : '';
  const line = redact(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};
