import { useEffect, useRef } from 'react';
import { navigate, type Route } from '../lib/router';
import { deepEqual } from '../lib/store';
import { decodeView, encodeView } from '../lib/viewUrl';
import { viewsStore, type ViewState } from './views';

/**
 * Keeps the address and the current view in step.
 *
 *  - Address → view: when the address changes from outside (a shared link
 *    is opened, the back button is used), its view parameters are applied.
 *    An address without view parameters keeps the user's own state.
 *  - View → address: every change of filters, search, quick filter or
 *    sorting replaces the address (no new history entry per keystroke).
 */
export function useViewUrlSync(route: Route, current: ViewState): void {
  /** The view parameters last read from or written to the address. */
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (route.page !== 'alerts') {
      lastSeen.current = null;
      return;
    }
    if (route.view !== lastSeen.current) {
      lastSeen.current = route.view;
      const shared = decodeView(route.view);
      if (shared && !deepEqual(shared, current)) {
        viewsStore.set((data) => ({ ...data, current: shared, activeViewId: null }));
        // The state change runs this effect again, which then tidies the address.
        return;
      }
    }
    const encoded = encodeView(current);
    if (encoded !== route.view) {
      lastSeen.current = encoded;
      navigate({ view: encoded }, { replace: true });
    }
  }, [route.page, route.view, current]);
}
