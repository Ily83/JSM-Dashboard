import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Reads and updates a .env file without losing its comments or the settings
 * it does not touch. Values are parsed by Node's own parser (the one
 * `process.loadEnvFile` uses), so what is written is read back the same way.
 */

export type EnvValues = Record<string, string>;

export class EnvFileError extends Error {
  /** `io`: the file could not be read or written, as opposed to a value that cannot be stored. */
  constructor(message: string, readonly io = false) {
    super(message);
    this.name = 'EnvFileError';
  }
}

export function parseEnvText(text: string): EnvValues {
  const values: EnvValues = {};
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (value !== undefined) values[key] = value;
  }
  return values;
}

/** The file's text, or '' when there is no file yet. */
export function readEnvText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new EnvFileError('Could not read the configuration file.', true);
  }
}

const PLAIN = /^[A-Za-z0-9_.:/@,=+\-{}*?!%&()[\]|~^ ]*$/;

/** One value as a .env line needs it: plain when safe, else quoted with a quote it does not contain. */
export function formatEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new EnvFileError('A setting cannot contain a line break.');
  if (PLAIN.test(value) && value === value.trim()) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  if (!value.includes('`')) return `\`${value}\``;
  throw new EnvFileError('A setting cannot contain all three kinds of quotes.');
}

const pattern = (prefix: string, key: string) => new RegExp(String.raw`^\s*${prefix}${key.replaceAll(/\W/g, '')}\s*=`);
const activeLine = (key: string) => pattern(String.raw`(?:export\s+)?`, key);
const templateLine = (key: string) => pattern(String.raw`#\s*`, key);
const positionsOf = (lines: readonly string[], test: RegExp) => lines.flatMap((line, index) => (test.test(line) ? [index] : []));

/** One change, made in the lines: a string sets the value, null removes the setting. */
function applyChange(lines: string[], key: string, value: string | null): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new EnvFileError('Invalid setting name.');
  const positions = positionsOf(lines, activeLine(key));
  // Later duplicates would override the first, so only the first place is kept.
  const remove = value === null ? positions : positions.slice(1);
  for (const index of remove.toReversed()) lines.splice(index, 1);
  if (value === null) return;
  const line = `${key}=${formatEnvValue(value)}`;
  if (positions.length > 0) {
    lines[positions[0]] = line;
    return;
  }
  const example = positionsOf(lines, templateLine(key)).at(-1);
  if (example === undefined) lines.push(line);
  else lines.splice(example + 1, 0, line);
}

/** Whether the new text reads back as the old settings with exactly these changes. */
function readsBackAsIntended(before: EnvValues, after: EnvValues, changes: Record<string, string | null>): boolean {
  const expected: EnvValues = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete expected[key];
    else expected[key] = value;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(after)]);
  return [...keys].every((key) => expected[key] === after[key]);
}

/**
 * The text with these settings changed: a string sets the value, null removes
 * the setting. A setting keeps its place; a new one goes below its commented
 * example when the file has one, else at the end. Every other line is kept.
 * Throws when the result would not read back as intended.
 */
export function updateEnvText(text: string, changes: Record<string, string | null>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const [key, value] of Object.entries(changes)) applyChange(lines, key, value);
  const result = lines.length === 0 ? '' : lines.join(eol) + eol;
  if (!readsBackAsIntended(parseEnvText(text), parseEnvText(result), changes)) {
    throw new EnvFileError('The configuration file could not be updated safely. Edit it by hand.');
  }
  return result;
}

/** Replaces the file in one step, readable by its owner only where the system supports that. */
export function writeEnvText(file: string, text: string): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    rmSync(temporary, { force: true });
    throw new EnvFileError('Could not write the configuration file. Check that its folder is writable.', true);
  }
}
