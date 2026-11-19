import { describe, expect, it } from 'vitest';
import { findRunbook, splitLinks } from '../src/components/ui/Linkify';

describe('links in alert text', () => {
  it('links http and https only, and leaves trailing punctuation outside', () => {
    expect(splitLinks('See https://wiki.example.com/runbooks/aks. Then call.')).toEqual([
      { text: 'See ' },
      { text: 'https://wiki.example.com/runbooks/aks', href: 'https://wiki.example.com/runbooks/aks' },
      { text: '. Then call.' },
    ]);
    expect(splitLinks('javascript:alert(1) data:text/html,x ftp://x.example')).toEqual([{ text: 'javascript:alert(1) data:text/html,x ftp://x.example' }]);
  });

  it('keeps a closing bracket that belongs to the address', () => {
    const parts = splitLinks('(https://en.example.org/wiki/Foo_(bar))');
    expect(parts.find((p) => p.href)?.href).toBe('https://en.example.org/wiki/Foo_(bar))');
  });

  it('finds the runbook in a property first, then in the description', () => {
    expect(findRunbook({ runbookUrl: 'https://kb.example.com/1', other: 'https://x.example' }, null)).toBe('https://kb.example.com/1');
    expect(findRunbook({}, 'Impact: high\nRunbook: https://kb.example.com/2\nhttps://x.example')).toBe('https://kb.example.com/2');
    expect(findRunbook({ owner: 'https://x.example' }, 'No link here')).toBeNull();
  });
});
