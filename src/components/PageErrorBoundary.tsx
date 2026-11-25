import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface PageErrorBoundaryProps {
  children: ReactNode;
}

interface PageErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps the app on screen when a page that loads on demand (History,
 * Workflows, Settings) cannot load, for example when the server no longer has
 * its file. Give it a `key` per page so another page gets a fresh try.
 */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  override state: PageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <div role="alert" className="max-w-md text-center">
          <TriangleAlert size={28} aria-hidden className="mx-auto text-crit" />
          <p className="mt-2 font-semibold">This page could not be loaded</p>
          <button type="button" onClick={() => location.reload()} className="mt-3 h-7 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
