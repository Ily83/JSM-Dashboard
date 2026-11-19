/** A random id for locally stored items (saved views, investigations). */
export function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Removes every leading and trailing occurrence of one character, without a regular expression. */
export function trimChar(text: string, char: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === char) start += 1;
  while (end > start && text[end - 1] === char) end -= 1;
  return text.slice(start, end);
}
