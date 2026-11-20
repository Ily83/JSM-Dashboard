import { describe, expect, it } from 'vitest';
import { MENU_MARGIN, placeMenu } from '../src/components/ui/menuPlacement';

const viewport = { width: 1280, height: 800 };
const size = { width: 220, height: 300 };

describe('menu placement', () => {
  it('opens below and to the right of the pointer when it fits', () => {
    expect(placeMenu({ kind: 'point', x: 100, y: 120 }, size, viewport)).toEqual({ left: 100, top: 120 });
  });

  it('flips upward when there is no room below', () => {
    expect(placeMenu({ kind: 'point', x: 100, y: 700 }, size, viewport)).toEqual({ left: 100, top: 400 });
  });

  it('flips to the left of the pointer near the right edge', () => {
    expect(placeMenu({ kind: 'point', x: 1200, y: 100 }, size, viewport)).toEqual({ left: 980, top: 100 });
  });

  it('keeps the margin when neither side has room', () => {
    const tall = { width: 220, height: 700 };
    const { top } = placeMenu({ kind: 'point', x: 100, y: 400 }, tall, viewport);
    expect(top).toBe(viewport.height - MENU_MARGIN - tall.height);
    expect(top).toBeGreaterThanOrEqual(MENU_MARGIN);
  });

  it('never goes past the top-left margin', () => {
    expect(placeMenu({ kind: 'point', x: -50, y: -20 }, size, viewport)).toEqual({ left: MENU_MARGIN, top: MENU_MARGIN });
  });

  it('opens against a rectangle: under it, or above it near the bottom', () => {
    const row = { kind: 'rect', left: 300, right: 300, top: 200, bottom: 230 } as const;
    expect(placeMenu(row, size, viewport)).toEqual({ left: 300, top: 230 });
    const low = { kind: 'rect', left: 300, right: 300, top: 650, bottom: 680 } as const;
    expect(placeMenu(low, size, viewport)).toEqual({ left: 300, top: 350 });
  });

  it('ends at a button’s right edge when it cannot start at its left edge', () => {
    const button = { kind: 'rect', left: 1200, right: 1228, top: 100, bottom: 128 } as const;
    expect(placeMenu(button, size, viewport)).toEqual({ left: 1008, top: 128 });
  });
});
