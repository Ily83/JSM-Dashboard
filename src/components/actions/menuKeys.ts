/**
 * Keyboard rules of the alert menu (AlertMenu.tsx), kept free of the DOM.
 */

/**
 * The item an arrow key, Home or End moves to in a list of `count` items, from
 * the item at `index` (-1 when none has focus); undefined for any other key.
 * The arrows wrap around.
 */
export function menuMove(key: string, index: number, count: number): number | undefined {
  const last = count - 1;
  const moves: Record<string, number> = {
    ArrowDown: index < 0 || index === last ? 0 : index + 1,
    ArrowUp: index <= 0 ? last : index - 1,
    Home: 0,
    End: last,
  };
  return key in moves ? moves[key] : undefined;
}

/**
 * Tab inside a picker or a question stays inside, like a dialog: from the last
 * of `count` controls it wraps to the first, and Shift+Tab from the first (or
 * from outside them, `index` -1) to the last. Null when Tab moves on normally.
 */
export function tabWrap(index: number, count: number, backwards: boolean): number | null {
  const edge = backwards ? index <= 0 : index === count - 1;
  if (!edge) return null;
  return backwards ? count - 1 : 0;
}
