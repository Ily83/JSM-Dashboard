import { useEffect, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import type { SectionId } from '../config/sections';
import { cn } from '../lib/cn';
import { routeHash } from '../lib/router';
import { encodeView } from '../lib/viewUrl';
import type { ViewState } from '../state/views';

type CopyState = 'idle' | 'copied' | 'failed';

const TIP: Record<CopyState, string> = { idle: 'Copy link to this view', copied: 'Link copied', failed: 'Copy failed' };
const TONE: Record<CopyState, string> = { idle: 'text-muted', copied: 'text-ok', failed: 'text-crit' };

/** Copies a link to the list as it is shown now: section, filters, search, sorting and the open alert. */
export function CopyLinkButton({ section, view, alertId }: Readonly<{ section: SectionId; view: ViewState; alertId: string | null }>) {
  const [state, setState] = useState<CopyState>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    // "v=1" marks the link as a complete view, so it also clears filters on the receiving side.
    const hash = routeHash({ page: 'alerts', section, alertId, view: encodeView(view, { explicit: true }) });
    const url = `${globalThis.location.origin}${globalThis.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy link to this view"
      data-tip={TIP[state]}
      data-tip-always=""
      className={cn(
        'flex size-7 items-center justify-center rounded-md border border-line-strong bg-panel hover:bg-hover hover:text-fg',
        TONE[state],
      )}
    >
      {state === 'copied' ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
    </button>
  );
}
