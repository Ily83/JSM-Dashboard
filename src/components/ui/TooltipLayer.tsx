import { useEffect, useRef, useState } from 'react';

/**
 * One tooltip for the whole application, driven by event delegation.
 *
 * Any element with `data-tip="text"` gets a tooltip when its content is
 * truncated (or always, with `data-tip-always`). Table cells therefore need
 * no per-cell listeners or components, which keeps thousands of rows cheap.
 * Works for mouse hover and keyboard focus.
 */
interface TipState {
  text: string;
  x: number;
  y: number;
  above: boolean;
}

const SHOW_DELAY_MS = 350;

function findTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null;
}

function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text || !el.isConnected) return;
      if (!('tipAlways' in el.dataset) && !isTruncated(el)) return;
      const rect = el.getBoundingClientRect();
      const above = rect.bottom + 120 > window.innerHeight;
      setTip({
        text,
        x: Math.min(Math.max(8, rect.left), window.innerWidth - 380),
        y: above ? rect.top - 6 : rect.bottom + 6,
        above,
      });
    };
    const enter = (event: Event) => {
      const el = findTarget(event.target);
      if (el === current.current) return;
      hide();
      if (!el) return;
      current.current = el;
      timer.current = setTimeout(() => show(el), event.type === 'focusin' ? 0 : SHOW_DELAY_MS);
    };
    const leave = (event: MouseEvent) => {
      const next = findTarget(event.relatedTarget);
      if (next !== current.current) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('mouseover', enter);
    document.addEventListener('mouseout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', enter);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[372px] whitespace-pre-line break-words rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-xs leading-snug text-fg shadow-pop"
      style={{ left: tip.x, top: tip.y, transform: tip.above ? 'translateY(-100%)' : undefined }}
    >
      {tip.text}
    </div>
  );
}
