import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpFromLine,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  CircleCheck,
  Flag,
  MessageSquarePlus,
  PanelRightOpen,
  Play,
  RotateCcw,
  Tag,
  TagX,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { ACTION_LABEL, NOTE_MAX_LENGTH, TAG_MAX_LENGTH, TAGS_MAX_PER_REQUEST, type ActionId, type AlertAction } from '../../../shared/actions';
import type { Alert } from '../../../shared/types';
import { useAlertDetail } from '../../api/hooks';
import { cn } from '../../lib/cn';
import { button, confirmCloseButton, primaryButton } from '../ui/buttons';
import { placeMenu, type MenuAnchor } from '../ui/menuPlacement';
import { appliesTo, CONFIRM_LABEL, needsConfirm, questionText, type BulkOperation, type PickerAction } from './bulkRules';
import { AssignPicker, EscalatePicker, PriorityPicker, ResponderPicker, SnoozePicker } from './Pickers';

/**
 * The alert menu: right-click or Shift+F10 on a row, or the bulk bar's More
 * actions button. A WAI-ARIA menu (arrow keys, Home and End, Tab and Escape
 * close it); actions that need a choice open a picker in place of the list,
 * and confirmations are asked here, next to the pointer.
 *
 * One alert is changed at once; more than one, a close or a custom action
 * asks first (rules in bulkRules.ts).
 */

export interface AlertContextMenu {
  /** Where it opens: at the pointer, or against the row or button it was opened from. */
  anchor: MenuAnchor;
  /** The alert whose details "Open alert details" shows; null for a group or several alerts. */
  alertId: string | null;
  /** Puts focus back where the menu was opened from; called unless it was dismissed by a pointer elsewhere. */
  restoreFocus?: () => void;
  /** The button that opened it: pressing it again closes the menu instead of reopening it. */
  trigger?: HTMLElement | null;
}

type MenuItemId = 'open' | BulkOperation;

const PICKER_ACTIONS: readonly PickerAction[] = ['assign', 'snooze', 'priority', 'addResponder', 'escalate', 'addTags', 'removeTags', 'addNote', 'customAction'];
const isPicker = (id: MenuItemId): id is PickerAction => (PICKER_ACTIONS as readonly string[]).includes(id);

const GROUPS: readonly (readonly MenuItemId[])[] = [
  ['open'],
  ['acknowledge', 'unacknowledge', 'close'],
  ['assign', 'snooze', 'priority'],
  ['addResponder', 'escalate', 'addTags', 'removeTags', 'addNote', 'customAction'],
];

const ICON: Record<MenuItemId, LucideIcon> = {
  open: PanelRightOpen,
  acknowledge: CheckCheck,
  unacknowledge: RotateCcw,
  close: CircleCheck,
  assign: UserPlus,
  snooze: BellOff,
  priority: Flag,
  addResponder: UsersRound,
  escalate: ArrowUpFromLine,
  addTags: Tag,
  removeTags: TagX,
  addNote: MessageSquarePlus,
  customAction: Play,
};

/** Same keys as in the detail panel. */
const HINT: Partial<Record<MenuItemId, string>> = { acknowledge: 'A', unacknowledge: 'U', close: 'C' };
const ACCELERATOR: Record<string, MenuItemId> = { a: 'acknowledge', u: 'unacknowledge', c: 'close' };

const NOT_APPLICABLE: Partial<Record<MenuItemId, string>> = {
  acknowledge: 'Already acknowledged',
  unacknowledge: 'Not acknowledged',
};

const snoozeEnd = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Item {
  id: MenuItemId;
  label: string;
  count: number;
  disabled: boolean;
  /** Why it is disabled, shown as a tooltip. */
  reason?: string;
}

type View =
  | { kind: 'list'; focus?: MenuItemId }
  | { kind: 'picker'; action: PickerAction }
  | { kind: 'confirm'; request: AlertAction; name?: string; targets: Alert[]; skipped: number };

const itemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-fg hover:bg-hover active:bg-line focus-visible:bg-hover focus-visible:-outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:active:bg-transparent';
const smallIconButton =
  'inline-flex size-6 flex-none items-center justify-center rounded text-muted hover:bg-hover hover:text-fg active:bg-line';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: Element | null | undefined): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

function TextActionPicker({ action, onPick }: Readonly<{ action: 'addNote' | 'addTags' | 'removeTags'; onPick: (request: AlertAction) => void }>) {
  const [text, setText] = useState('');
  const tags = [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))];
  const note = text.trim();
  const overLimit = action !== 'addNote' && (tags.length > TAGS_MAX_PER_REQUEST || tags.some((tag) => tag.length > TAG_MAX_LENGTH));
  const valid = action === 'addNote' ? note.length > 0 && note.length <= NOTE_MAX_LENGTH : tags.length > 0 && !overLimit;
  const submit = () => {
    if (!valid) return;
    onPick(action === 'addNote' ? { action, note } : { action, tags });
  };
  const field = 'w-full rounded-md border border-line-strong bg-panel px-2 text-xs text-fg placeholder:text-subtle hover:border-muted focus:border-accent focus:outline-none';
  return (
    <form
      className="grid w-64 gap-2 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {action === 'addNote' ? (
        <textarea
          autoFocus
          aria-label="Note"
          aria-keyshortcuts="Control+Enter"
          placeholder="Note"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
          className={cn(field, 'resize-y py-1.5')}
        />
      ) : (
        <input
          autoFocus
          aria-label="Tags"
          aria-invalid={overLimit || undefined}
          placeholder="tag, customer:Name"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={cn(field, 'h-7')}
        />
      )}
      {overLimit && (
        <p role="alert" className="text-[11px] text-crit">
          Up to {TAGS_MAX_PER_REQUEST} tags, {TAG_MAX_LENGTH} characters each
        </p>
      )}
      <button
        type="submit"
        className={cn(primaryButton, 'justify-self-end')}
        disabled={!valid}
        data-tip={action === 'addNote' ? 'Ctrl+Enter' : 'Enter'}
        data-tip-always=""
      >
        {CONFIRM_LABEL[action]}
      </button>
    </form>
  );
}

function CustomActionPicker({ alert, onPick }: Readonly<{ alert: Alert; onPick: (request: AlertAction) => void }>) {
  const detail = useAlertDetail(alert.id, alert.updatedAt);
  if (detail.isPending) return <p className="p-2 text-muted">Loading actions…</p>;
  if (detail.error) return <p role="alert" className="p-2 text-crit">{detail.error.message}</p>;
  const actions = detail.data?.actions ?? [];
  if (actions.length === 0) return <p className="p-2 text-muted">No custom actions</p>;
  return (
    <div className="grid w-60 gap-0.5 p-1">
      {actions.map((actionName) => (
        <button key={actionName} type="button" className={itemClass} onClick={() => onPick({ action: 'customAction', actionName })}>
          <Play size={13} aria-hidden className="flex-none text-muted" />
          <span className="min-w-0 truncate">{actionName}</span>
        </button>
      ))}
    </div>
  );
}

function MenuItemButton({ item, showCount, hints, onActivate }: Readonly<{ item: Item; showCount: boolean; hints: boolean; onActivate: (id: MenuItemId) => void }>) {
  const Icon = ICON[item.id];
  const hint = HINT[item.id];
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-item={item.id}
      aria-disabled={item.disabled || undefined}
      aria-keyshortcuts={hint}
      data-tip={item.reason}
      data-tip-always={item.reason ? '' : undefined}
      className={itemClass}
      onClick={() => onActivate(item.id)}
    >
      <Icon size={14} aria-hidden className="flex-none text-muted" />
      <span className="min-w-0 flex-1 truncate pr-3">{item.label}</span>
      {showCount && item.id !== 'open' && <span className="min-w-[2ch] text-right tabular-nums text-muted">{item.count}</span>}
      {hints && (
        <kbd aria-hidden="true" className="w-3 flex-none text-center font-sans text-[11px] text-subtle">
          {hint ?? ''}
        </kbd>
      )}
    </button>
  );
}

export function AlertMenu({
  menu,
  selected,
  allowed,
  busy,
  onRun,
  onOpenAlert,
  onClose,
}: Readonly<{
  menu: AlertContextMenu;
  selected: Alert[];
  allowed: ReadonlySet<ActionId>;
  /** True while a bulk action runs: no second one can start. */
  busy: boolean;
  onRun: (request: AlertAction, name: string | undefined, targets: Alert[], skipped: number) => void;
  onOpenAlert: (id: string) => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const ids = useId();
  const countId = `${ids}-count`;
  const footId = `${ids}-foot`;
  const questionId = `${ids}-question`;
  const closing = useRef(false);

  const close = useCallback(
    (restoreFocus: boolean) => {
      if (closing.current) return;
      closing.current = true;
      if (restoreFocus) menu.restoreFocus?.();
      onClose();
    },
    [menu, onClose],
  );

  // ---- Placement: against the anchor, inside the viewport, again whenever the size changes.
  const place = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const { left, top } = placeMenu(menu.anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [menu.anchor]);

  const viewRef = useRef(view);
  viewRef.current = view;

  /** Focus for the current view: the wanted (or first enabled) item, or the first control of a picker. */
  const focusView = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const current = viewRef.current;
    if (current.kind === 'list') {
      const items = Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const wanted = current.focus ? items.find((item) => item.dataset.item === current.focus) : undefined;
      (wanted ?? items.find((item) => !item.hasAttribute('aria-disabled')) ?? items[0] ?? element).focus({ preventScroll: true });
      return;
    }
    const body = element.querySelector('[data-view-body]');
    if (body?.contains(document.activeElement)) return;
    (focusables(body)[0] ?? element).focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    place();
    focusView();
  }, [view, place, focusView]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Async content (people, teams, custom actions) changes the size: place again,
    // and focus the first control once there is one.
    const observer = new ResizeObserver(() => {
      place();
      if (document.activeElement === element && viewRef.current.kind !== 'list') focusView();
    });
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [place, focusView]);

  // ---- Dismissal: Escape (back to the list first), a pointer or a scroll elsewhere.
  useEffect(() => {
    const outside = (target: EventTarget | null) => !ref.current?.contains(target as Node);
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target) && !menu.trigger?.contains(event.target as Node)) close(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const current = viewRef.current;
      if (current.kind === 'list') close(true);
      else setView({ kind: 'list', focus: current.kind === 'picker' ? current.action : current.request.action });
    };
    // Scrolling by hand closes it. Listening to the gesture, not to `scroll`: a scroll event can
    // arrive just after the menu opened for a scroll that happened before (focus, scrollIntoView).
    const onScroll = (event: Event) => {
      if (outside(event.target)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', onScroll, { capture: true, passive: true });
    document.addEventListener('touchmove', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('wheel', onScroll, { capture: true });
      document.removeEventListener('touchmove', onScroll, { capture: true });
    };
  }, [close, menu.trigger]);

  const many = selected.length > 1;
  const first = selected[0];
  const backendOff = (id: MenuItemId) => id !== 'open' && !allowed.has(id);
  const items: Item[][] = GROUPS.map((group) =>
    group.flatMap((id): Item[] => {
      if (id === 'open') return menu.alertId ? [{ id, label: 'Open alert details', count: 0, disabled: false }] : [];
      const count = selected.filter((alert) => appliesTo(id, alert)).length;
      let reason: string | undefined;
      if (backendOff(id)) reason = 'Turned off in the backend';
      else if (busy) reason = 'Another action is running';
      else if (id === 'customAction' && selected.length !== 1) reason = 'Custom actions are specific to one alert';
      else if (count === 0) reason = NOT_APPLICABLE[id] ?? 'Not available on closed alerts';
      return [{ id, label: `${ACTION_LABEL[id]}${isPicker(id) ? '…' : ''}`, count, disabled: reason !== undefined, reason }];
    }),
  ).filter((group) => group.length > 0);
  const anyBackendOff = items.flat().some((item) => backendOff(item.id));

  /** Runs the request now when it changes one alert, else asks first. */
  const request = (action: AlertAction, name?: string) => {
    const targets = selected.filter((alert) => appliesTo(action.action, alert));
    if (targets.length === 0 || busy) return;
    const skipped = selected.length - targets.length;
    if (needsConfirm(action.action, targets.length)) {
      setView({ kind: 'confirm', request: action, name, targets, skipped });
      return;
    }
    onRun(action, name, targets, skipped);
    close(true);
  };

  const activate = (id: MenuItemId) => {
    const item = items.flat().find((candidate) => candidate.id === id);
    if (!item || item.disabled) return;
    if (id === 'open') {
      if (menu.alertId) onOpenAlert(menu.alertId);
      close(true);
    } else if (isPicker(id)) {
      setView({ kind: 'picker', action: id });
    } else {
      request({ action: id });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element) return;
    if (event.key === 'Tab') {
      if (view.kind === 'list') {
        event.preventDefault();
        close(true);
        return;
      }
      // Pickers and questions keep Tab inside, like a dialog.
      const controls = focusables(element);
      if (controls.length === 0) return;
      const index = controls.indexOf(document.activeElement as HTMLElement);
      const edge = event.shiftKey ? index <= 0 : index === controls.length - 1;
      if (edge) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
      return;
    }
    if (view.kind !== 'list') return;
    const menuItems = Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const index = menuItems.indexOf(document.activeElement as HTMLElement);
    const last = menuItems.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: index < 0 || index === last ? 0 : index + 1,
      ArrowUp: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      menuItems[moves[event.key]]?.focus();
      return;
    }
    const accelerator = event.ctrlKey || event.metaKey || event.altKey ? undefined : ACCELERATOR[event.key.toLowerCase()];
    if (accelerator) {
      event.preventDefault();
      activate(accelerator);
    }
  };

  let content: ReactNode;
  if (view.kind === 'list') {
    content = (
      <div role="menu" aria-label="Alert actions" aria-describedby={anyBackendOff ? `${countId} ${footId}` : countId} className="grid">
        <div id={countId} aria-hidden="true" className="px-2 pb-1 pt-0.5 text-[11px] font-semibold tabular-nums text-muted">
          {selected.length} selected
        </div>
        {items.map((group, index) => (
          <Fragment key={group[0].id}>
            {index > 0 && <div role="separator" className="mx-1 my-1 border-t border-line" />}
            {group.map((item) => (
              <MenuItemButton key={item.id} item={item} showCount={many} hints onActivate={activate} />
            ))}
          </Fragment>
        ))}
        {anyBackendOff && (
          <div id={footId} aria-hidden="true" className="mt-1 border-t border-line px-2 pb-0.5 pt-1.5 text-[11px] text-muted">
            Disabled actions must be enabled in the backend.
          </div>
        )}
      </div>
    );
  } else if (view.kind === 'confirm') {
    const isClose = view.request.action === 'close';
    const caveat = view.targets.length > 1 && (view.request.action === 'addResponder' || view.request.action === 'escalate');
    content = (
      <div role="dialog" aria-labelledby={questionId} data-view-body="" className="grid w-max min-w-52 max-w-72 gap-2 p-2">
        <p id={questionId} className="break-words font-semibold">
          {questionText(view.request, view.targets.length, view.name)}
        </p>
        {(view.skipped > 0 || caveat) && (
          <p className="text-[11px] text-muted">
            {view.skipped > 0 && (
              <span data-tip="Not applicable or closed" data-tip-always="">
                {view.skipped} skipped
              </span>
            )}
            {view.skipped > 0 && caveat && ' · '}
            {caveat && 'Jira may refuse it for some alerts'}
          </p>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-describedby={questionId}
            className={isClose ? confirmCloseButton : primaryButton}
            onClick={() => {
              onRun(view.request, view.name, view.targets, view.skipped);
              close(true);
            }}
          >
            {isClose && <Check size={13} aria-hidden />}
            {CONFIRM_LABEL[view.request.action]}
          </button>
          <button type="button" className={button} onClick={() => setView({ kind: 'list', focus: view.request.action })}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else {
    const action = view.action;
    const pick = (value: AlertAction, name?: string) => request(value, name);
    content = (
      <div role="dialog" aria-label={ACTION_LABEL[action]} className="grid">
        <div className="flex items-center gap-1 border-b border-line pb-1">
          <button type="button" aria-label="Back" data-tip="Back · Esc" data-tip-always="" className={smallIconButton} onClick={() => setView({ kind: 'list', focus: action })}>
            <ChevronLeft size={14} aria-hidden />
          </button>
          <span className="font-semibold">{ACTION_LABEL[action]}</span>
          <span className="ml-auto pr-1.5 text-[11px] tabular-nums text-muted">{selected.length} selected</span>
        </div>
        <div data-view-body="">
          {(action === 'addResponder' || action === 'escalate') && many && (
            <p className="px-2 pt-1.5 text-[11px] text-muted" data-tip="Choices come from the first selected alert; Jira may refuse them for the others." data-tip-always="">
              From the first alert
            </p>
          )}
          {action === 'assign' && <AssignPicker onPick={(accountId, name) => pick({ action: 'assign', accountId }, name)} />}
          {action === 'snooze' && <SnoozePicker onPick={(endTime) => pick({ action: 'snooze', endTime }, snoozeEnd.format(new Date(endTime)))} />}
          {action === 'priority' && <PriorityPicker current={many ? undefined : first?.priority} onPick={(priority) => pick({ action: 'priority', priority })} />}
          {action === 'addResponder' && first && <ResponderPicker alert={first} onPick={(responder, name) => pick({ action: 'addResponder', responder }, name)} />}
          {action === 'escalate' && first && <EscalatePicker alert={first} onPick={(escalationId, name) => pick({ action: 'escalate', escalationId }, name)} />}
          {(action === 'addNote' || action === 'addTags' || action === 'removeTags') && <TextActionPicker action={action} onPick={pick} />}
          {action === 'customAction' && first && <CustomActionPicker alert={first} onPick={pick} />}
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      ref={ref}
      data-context-menu=""
      tabIndex={-1}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-max min-w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-line-strong bg-panel p-1 text-xs text-fg shadow-pop focus-visible:outline-none"
      style={{ left: menu.anchor.kind === 'point' ? menu.anchor.x : menu.anchor.left, top: menu.anchor.kind === 'point' ? menu.anchor.y : menu.anchor.bottom }}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Focus moved elsewhere (a click outside is handled above, "/" to search, ...).
        // Focus moving to the menu's own trigger is that button's click, which toggles the menu.
        const next = event.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next) && !menu.trigger?.contains(next)) close(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {content}
    </div>,
    document.body,
  );
}
