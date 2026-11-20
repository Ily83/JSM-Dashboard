/**
 * Where a floating menu goes: next to the pointer, or against the rectangle
 * of the element it was opened from (a row opened by keyboard, a button).
 * Kept free of the DOM so it can be tested.
 */

export type MenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'rect'; left: number; top: number; right: number; bottom: number };

export interface Size {
  width: number;
  height: number;
}

/** Distance kept from the viewport edges. */
export const MENU_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function anchorFromRect(rect: { left: number; top: number; right: number; bottom: number }): MenuAnchor {
  return { kind: 'rect', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/**
 * Top-left corner of a menu of `size`: below the anchor when it fits, else
 * above it (flipped upward), else as low as the viewport allows. Starts at
 * the anchor's left edge and flips to end at its right edge when there is no
 * room. Always `margin` px inside the viewport.
 */
export function placeMenu(anchor: MenuAnchor, size: Size, viewport: Size, margin = MENU_MARGIN): { left: number; top: number } {
  const below = anchor.kind === 'point' ? anchor.y : anchor.bottom;
  const above = anchor.kind === 'point' ? anchor.y : anchor.top;
  const start = anchor.kind === 'point' ? anchor.x : anchor.left;
  const end = anchor.kind === 'point' ? anchor.x : anchor.right;
  const bottomLimit = viewport.height - margin;
  const rightLimit = viewport.width - margin;

  let top: number;
  if (below + size.height <= bottomLimit) top = below;
  else if (above - size.height >= margin) top = above - size.height;
  else top = bottomLimit - size.height;

  const left = start + size.width <= rightLimit ? start : end - size.width;
  return {
    left: clamp(left, margin, rightLimit - size.width),
    top: clamp(top, margin, bottomLimit - size.height),
  };
}
