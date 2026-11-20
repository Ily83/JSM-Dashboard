import { GRID_COLUMNS, WIDGETS, WIDGET_BY_ID, isWidgetId, type WidgetId } from '../config/widgets';
import { createPersistentStore, isRecord } from '../lib/store';

/** Which widgets are on the dashboard, in what order and size. */
export interface WidgetPlacement {
  id: WidgetId;
  visible: boolean;
  /** Width in grid columns (of 12) and height in row units. */
  w: number;
  h: number;
}

export interface DashboardLayout {
  /** Dashboard hidden to give the table the whole screen. */
  collapsed: boolean;
  /** Display order. */
  widgets: WidgetPlacement[];
}

export const DEFAULT_DASHBOARD = (): DashboardLayout => ({
  collapsed: false,
  widgets: WIDGETS.map((w) => ({ id: w.id, visible: w.defaultVisible, w: w.w, h: w.h })),
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export function sanitizeDashboard(stored: unknown, fallback: DashboardLayout = DEFAULT_DASHBOARD()): DashboardLayout {
  if (!isRecord(stored) || !Array.isArray(stored.widgets)) return fallback;
  const seen = new Set<WidgetId>();
  const widgets: WidgetPlacement[] = [];
  for (const item of stored.widgets) {
    if (!isRecord(item) || !isWidgetId(item.id) || seen.has(item.id)) continue;
    const def = WIDGET_BY_ID[item.id];
    seen.add(item.id);
    widgets.push({
      id: item.id,
      visible: item.visible === true,
      w: clamp(typeof item.w === 'number' ? item.w : def.w, def.minW, Math.min(def.maxW, GRID_COLUMNS)),
      h: clamp(typeof item.h === 'number' ? item.h : def.h, def.minH, def.maxH),
    });
  }
  // Widgets added in a newer version are appended with their defaults.
  for (const def of WIDGETS) {
    if (!seen.has(def.id)) widgets.push({ id: def.id, visible: def.defaultVisible, w: def.w, h: def.h });
  }
  return { collapsed: stored.collapsed === true, widgets };
}

export const dashboardStore = createPersistentStore<DashboardLayout>('dashboard:v1', DEFAULT_DASHBOARD, sanitizeDashboard);

function patchWidget(id: WidgetId, patch: Partial<WidgetPlacement>): void {
  dashboardStore.set((layout) => ({
    ...layout,
    widgets: layout.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
}

export function setWidgetVisible(id: WidgetId, visible: boolean): void {
  patchWidget(id, { visible });
}

export function resizeWidget(id: WidgetId, w: number, h: number): void {
  const def = WIDGET_BY_ID[id];
  const current = dashboardStore.get().widgets.find((p) => p.id === id);
  const next = { w: clamp(w, def.minW, Math.min(def.maxW, GRID_COLUMNS)), h: clamp(h, def.minH, def.maxH) };
  if (current?.w === next.w && current.h === next.h) return;
  patchWidget(id, next);
}

/** Moves a widget so that it sits directly before or after another one. */
export function moveWidget(id: WidgetId, target: WidgetId, side: 'before' | 'after'): void {
  if (id === target) return;
  dashboardStore.set((layout) => {
    const moving = layout.widgets.find((w) => w.id === id);
    if (!moving) return layout;
    const rest = layout.widgets.filter((w) => w.id !== id);
    const index = rest.findIndex((w) => w.id === target);
    if (index < 0) return layout;
    rest.splice(index + (side === 'after' ? 1 : 0), 0, moving);
    return { ...layout, widgets: rest };
  });
}

/** Keyboard alternative to dragging: one position earlier or later among all widgets. */
export function shiftWidget(id: WidgetId, delta: -1 | 1): void {
  dashboardStore.set((layout) => {
    const widgets = [...layout.widgets];
    const from = widgets.findIndex((w) => w.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= widgets.length) return layout;
    [widgets[from], widgets[to]] = [widgets[to], widgets[from]];
    return { ...layout, widgets };
  });
}

export function setDashboardCollapsed(collapsed: boolean): void {
  dashboardStore.set((layout) => ({ ...layout, collapsed }));
}
