import { useEffect, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import type { SectionId } from '../config/sections';
import { cn } from '../lib/cn';
import { routeHash } from '../lib/router';
import { encodeView } from '../lib/viewUrl';
import type { ViewState } from '../state/views';

/** Copies a link to the list as it is shown now: section, filters, search, sorting and the open alert. */
export function CopyLinkButton({ section, view, alertId }: { section: SectionId; view: ViewState; alertId: string | null }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    // "v=1" marks the link as a complete view, so it also clears filters on the receiving side.
    const hash = routeHash({ page: 'alerts', section, alertId, view: encodeView(view, { explicit: true }) });
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const tip = state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed' : 'Copy link to this view';
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy link to this view"
      data-tip={tip}
      data-tip-always=""
      className={cn(
        'flex size-7 items-center justify-center rounded-md border border-line-strong bg-panel hover:bg-hover hover:text-fg',
        state === 'copied' ? 'text-ok' : state === 'failed' ? 'text-crit' : 'text-muted',
      )}
    >
      {state === 'copied' ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
    </button>
  );
}
