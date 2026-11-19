import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PopoverProps {
  /** Renders the trigger. Spread `props` on a button. */
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'dialog';
    onClick: () => void;
  }, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  label: string;
  className?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Click-to-open panel anchored to its trigger. Closes on outside click and Escape. */
export function Popover({ trigger, children, align = 'start', label, className, defaultOpen = false, onOpenChange }: PopoverProps) {
  const [open, setOpenState] = useState(defaultOpen);
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenState(value);
    onOpenChange?.(value);
  };
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {trigger(
        { 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': 'dialog', onClick: () => setOpen((v) => !v) },
        open,
      )}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute top-full z-30 mt-1 rounded-md border border-line-strong bg-panel shadow-pop',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
