import { memo } from 'react';
import { Activity, Bookmark, CheckCheck, CircleCheck, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings, Siren, Star, type LucideIcon } from 'lucide-react';
import { SECTIONS, SECTION_IDS, type SectionId } from '../config/sections';
import { cn } from '../lib/cn';
import type { Route } from '../lib/router';
import { applyView, openSection, type SavedView } from '../state/views';

const ICONS: Record<SectionId, LucideIcon> = {
  all: LayoutDashboard,
  critical: Siren,
  active: Activity,
  acknowledged: CheckCheck,
  resolved: CircleCheck,
};

interface SidebarProps {
  route: Route;
  counts: Record<SectionId, number>;
  collapsed: boolean;
  onToggle: () => void;
  views: SavedView[];
  activeViewId: string | null;
  defaultViewId: string | null;
}

const item = (active: boolean, collapsed: boolean) =>
  cn(
    'flex h-8 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md text-[13px] font-medium',
    collapsed ? 'justify-center px-0' : 'px-2.5',
    active ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-hover hover:text-fg',
  );

export const Sidebar = memo(function Sidebar({ route, counts, collapsed, onToggle, views, activeViewId, defaultViewId }: SidebarProps) {
  const onAlerts = route.page === 'alerts';
  return (
    <nav
      aria-label="Main"
      className={cn('flex flex-none flex-col border-r border-line bg-panel transition-[width] duration-150 motion-reduce:transition-none', collapsed ? 'w-12' : 'w-52')}
    >
      <div className={cn('flex h-11 flex-none items-center gap-2 border-b border-line', collapsed ? 'justify-center' : 'px-3')}>
        <span className="flex size-6 flex-none items-center justify-center rounded bg-accent text-on-accent">
          <Siren size={14} aria-hidden />
        </span>
        {!collapsed && <span className="truncate text-sm font-semibold">Alert Center</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {SECTION_IDS.map((id) => {
            const Icon = ICONS[id];
            // A saved view is highlighted instead of its section.
            const active = onAlerts && route.section === id && activeViewId === null;
            return (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  aria-current={active ? 'page' : undefined}
                  className={item(active, collapsed)}
                  data-tip={collapsed ? `${SECTIONS[id].label} (${counts[id]})` : undefined}
                  data-tip-always=""
                  onClick={(event) => {
                    event.preventDefault();
                    openSection(id);
                  }}
                >
                  <Icon size={16} aria-hidden className={cn('flex-none', id === 'critical' && counts.critical > 0 && 'text-crit')} />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{SECTIONS[id].label}</span>
                      <span className={cn('flex-none text-xs tabular-nums', id === 'critical' && counts.critical > 0 ? 'font-semibold text-crit' : 'text-subtle')}>
                        {counts[id]}
                      </span>
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {views.length > 0 && (
          <>
            <div className={cn('mt-3 border-t border-line pt-2', !collapsed && 'px-2.5')}>
              {!collapsed && <h2 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Saved views</h2>}
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
              {views.map((view) => {
                const active = onAlerts && activeViewId === view.id;
                return (
                  <li key={view.id}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      className={item(active, collapsed)}
                      data-tip={collapsed ? view.name : undefined}
                      data-tip-always=""
                      onClick={() => applyView(view.id)}
                    >
                      {defaultViewId === view.id ? (
                        <Star size={15} aria-label="Default view" className="flex-none fill-current text-warn" />
                      ) : (
                        <Bookmark size={15} aria-hidden className="flex-none" />
                      )}
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate text-left" data-tip={view.name}>
                          {view.name}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="grid flex-none gap-0.5 border-t border-line p-1.5">
        <a
          href="#/settings"
          aria-current={route.page === 'settings' ? 'page' : undefined}
          className={item(route.page === 'settings', collapsed)}
          data-tip={collapsed ? 'Settings' : undefined}
          data-tip-always=""
        >
          <Settings size={16} aria-hidden className="flex-none" />
          {!collapsed && 'Settings'}
        </a>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className={item(false, collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden className="flex-none" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </nav>
  );
});
