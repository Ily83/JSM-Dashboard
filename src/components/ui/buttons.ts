/**
 * Button class strings shared by the action surfaces (bulk bar, alert menu,
 * detail panel).
 *
 * `cn` only joins strings, so it cannot override a colour that a base string
 * already sets: whichever utility Tailwind emits later wins, whatever the
 * order in the class attribute. Each variant is therefore a complete string
 * of its own, never a base plus overrides.
 *
 * Disabled covers both `disabled` and `aria-disabled` (a button that stays
 * focusable while an action runs, so focus has somewhere to return to).
 */

const shape = 'inline-flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold';
const disabled =
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** Hover and pressed accent: mixed toward the text colour, so contrast with on-accent text rises in both themes. */
const accentHover = 'hover:border-[color-mix(in_srgb,var(--accent)_86%,var(--fg))] hover:bg-[color-mix(in_srgb,var(--accent)_86%,var(--fg))]';
const accentActive = 'active:border-[color-mix(in_srgb,var(--accent)_74%,var(--fg))] active:bg-[color-mix(in_srgb,var(--accent)_74%,var(--fg))]';

/** Neutral button on a panel or bar. */
export const button = `${shape} border-line-strong bg-panel text-fg hover:bg-hover active:bg-line ${disabled} disabled:hover:bg-panel aria-disabled:hover:bg-panel`;

/** The one primary action of a step (Confirm, Run, Snooze). */
export const primaryButton = `${shape} border-accent bg-accent text-on-accent ${accentHover} ${accentActive} ${disabled} disabled:hover:bg-accent aria-disabled:hover:bg-accent`;

/**
 * Confirms closing alerts: the green of the Close icon, as in the detail panel.
 * Hover tints the fill and pulls the text toward the foreground, so the text
 * keeps its contrast while the fill darkens (light) or lightens (dark).
 */
const okText = 'hover:text-[color-mix(in_srgb,var(--ok)_70%,var(--fg))] active:text-[color-mix(in_srgb,var(--ok)_70%,var(--fg))]';
export const confirmCloseButton = `${shape} border-ok bg-ok-soft text-ok ${okText} hover:bg-[color-mix(in_srgb,var(--ok-soft)_90%,var(--ok))] active:bg-[color-mix(in_srgb,var(--ok-soft)_80%,var(--ok))] ${disabled}`;

/** Square icon-only button; give it an aria-label and a data-tip. */
export const iconButton =
  `inline-flex size-7 flex-none items-center justify-center rounded-md border border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg active:bg-line ${disabled} disabled:hover:bg-panel disabled:hover:text-muted aria-disabled:hover:bg-panel`;

/** Borderless quiet button (Clear, Dismiss). */
export const quietButton =
  `inline-flex h-7 flex-none items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:bg-hover hover:text-fg active:bg-line ${disabled}`;
