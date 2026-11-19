import { Fragment } from 'react';

/**
 * Plain text with web addresses turned into links. Only http and https are
 * linked (never javascript: or data:), links open in a new tab without
 * access to this page, and everything else stays text, never HTML.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Punctuation that usually ends a sentence rather than the address.
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}']);

/** The run of sentence punctuation at the end of `url` (a loop: no backtracking on long runs). */
function trailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING.has(url[end - 1])) end -= 1;
  return url.slice(end);
}

export function splitLinks(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = trailingPunctuation(url);
    // Keep a closing bracket that belongs to the address, as in wiki links.
    const keep = trailing.startsWith(')') && url.includes('(') ? '' : trailing;
    url = url.slice(0, url.length - keep.length);
    let href: string | undefined;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') href = parsed.href;
    } catch {
      href = undefined;
    }
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push(href ? { text: url, href } : { text: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function Linkify({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

const RUNBOOK_KEY = /runbook|playbook|procedure|wiki|knowledge|kb\b|sop/i;

/**
 * The runbook of an alert: an extra property whose name suggests one and
 * whose value is a web address, else the first such address in the
 * description next to the word "runbook".
 */
export function findRunbook(properties: Record<string, string>, description: string | null): string | null {
  for (const [key, value] of Object.entries(properties)) {
    if (!RUNBOOK_KEY.test(key)) continue;
    const link = splitLinks(value).find((p) => p.href)?.href;
    if (link) return link;
  }
  if (description) {
    for (const line of description.split('\n')) {
      if (!RUNBOOK_KEY.test(line)) continue;
      const link = splitLinks(line).find((p) => p.href)?.href;
      if (link) return link;
    }
  }
  return null;
}
