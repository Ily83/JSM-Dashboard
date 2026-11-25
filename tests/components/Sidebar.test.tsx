// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../src/components/Sidebar';
import type { SectionId } from '../../src/config/sections';
import type { Route } from '../../src/lib/router';
import { viewsStore } from '../../src/state/views';

const COUNTS: Record<SectionId, number> = { all: 12, critical: 2, active: 9, acknowledged: 4, resolved: 3 };
const alertsRoute = (section: SectionId = 'all'): Route => ({ page: 'alerts', section, alertId: null, view: '' });

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onToggle = vi.fn();
  const props = {
    route: alertsRoute('critical'),
    counts: COUNTS,
    countsKnown: true,
    collapsed: false,
    onToggle,
    views: viewsStore.get().saved,
    activeViewId: null,
    defaultViewId: null,
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return { onToggle, nav: screen.getByRole('navigation', { name: 'Main' }) };
}

function narrowScreen(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  viewsStore.reset();
  window.location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sidebar', () => {
  it('lists the sections with their counts and marks the current one', () => {
    renderSidebar();
    const critical = screen.getByRole('link', { name: /^Critical Alerts\s*2$/ });
    expect(critical.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /^Active Alerts\s*9$/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Alert history' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Workflows' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('shows no counts until the alert list has loaded', () => {
    renderSidebar({ countsKnown: false });
    expect(screen.getByRole('link', { name: 'Critical Alerts' })).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('opens a section when its link is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('link', { name: /^Resolved Alerts\s*3$/ }));
    expect(window.location.hash).toBe('#/resolved');
  });

  it('marks the page of the other routes', () => {
    renderSidebar({ route: { page: 'history', section: 'all', alertId: null, view: '' } });
    expect(screen.getByRole('link', { name: 'Alert history' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /^Critical Alerts\s*2$/ }).getAttribute('aria-current')).toBeNull();
  });

  it('lists saved views, stars the default one and applies a view on click', async () => {
    const user = userEvent.setup();
    const [first, second] = viewsStore.get().saved;
    renderSidebar({ defaultViewId: second.id });

    expect(screen.getByRole('heading', { name: 'Saved views' })).toBeTruthy();
    const secondButton = screen.getByRole('button', { name: new RegExp(`^Default view\\s*${second.name}$`) });
    expect(within(secondButton).getByLabelText('Default view')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: first.name }));
    expect(viewsStore.get().activeViewId).toBe(first.id);
    expect(window.location.hash).toBe(`#/${first.section}`);
  });

  it('highlights the active saved view instead of its section', () => {
    const [view] = viewsStore.get().saved;
    renderSidebar({ route: alertsRoute(view.section), activeViewId: view.id });
    expect(screen.getByRole('button', { name: view.name }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /^Active Alerts\s*9$/ }).getAttribute('aria-current')).toBeNull();
  });

  it('hides the saved views block when there are none', () => {
    renderSidebar({ views: [] });
    expect(screen.queryByRole('heading', { name: 'Saved views' })).toBeNull();
  });

  it('collapses to an icon rail with tooltips and a toggle', async () => {
    const user = userEvent.setup();
    const { onToggle, nav } = renderSidebar({ collapsed: true });
    expect(within(nav).queryByText('Alert Center')).toBeNull();
    const critical = nav.querySelector('a[href="#/critical"]');
    expect(critical?.getAttribute('data-tip')).toBe('Critical Alerts (2)');

    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('offers a collapse button when expanded', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('forces the rail on a narrow screen, without a toggle', () => {
    narrowScreen(true);
    const { nav } = renderSidebar({ collapsed: false });
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
    expect(nav.querySelector('a[href="#/active"]')?.getAttribute('data-tip')).toBe('Active Alerts (9)');
  });
});
