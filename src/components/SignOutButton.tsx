import { useId, useRef } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '../lib/cn';
import { button, primaryButton } from './ui/buttons';

export function SignOutButton({ compact = false }: Readonly<{ compact?: boolean }>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        className={cn(button, compact && 'max-sm:px-1.5')}
        onClick={() => dialog.current?.showModal()}
      >
        <LogOut size={14} aria-hidden />
        <span className={compact ? 'max-sm:sr-only' : undefined}>Sign out</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        aria-describedby={description}
        onClose={() => trigger.current?.focus()}
        className="m-auto w-11/12 max-w-sm rounded-lg border border-line-strong bg-panel p-4 text-fg shadow-xl backdrop:bg-black/50"
      >
        <h2 id={title} className="text-sm font-semibold">Sign out of Alert Center?</h2>
        <p id={description} className="mt-2 text-sm text-muted">
          This ends your dashboard session. Your saved views are kept, and you stay signed in to Atlassian in your browser.
        </p>
        <form method="post" action="/api/auth/logout" className="mt-4 flex justify-end gap-2">
          <button type="button" className={button} onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className={primaryButton}>Sign out</button>
        </form>
      </dialog>
    </>
  );
}
