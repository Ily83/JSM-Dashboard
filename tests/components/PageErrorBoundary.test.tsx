// @vitest-environment jsdom
import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageErrorBoundary } from '../../src/components/PageErrorBoundary';

// A page whose file is gone, as after a rebuild when the server lost the old chunk.
const MissingPage = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));

describe('PageErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the page when it loads', () => {
    render(<PageErrorBoundary><p>History page</p></PageErrorBoundary>);
    expect(screen.getByText('History page')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the app on screen with a reload button when a page cannot load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <nav aria-label="Main">menu</nav>
        <PageErrorBoundary>
          <Suspense fallback={<p>loading</p>}><MissingPage /></Suspense>
        </PageErrorBoundary>
      </div>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This page could not be loaded');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });
});
