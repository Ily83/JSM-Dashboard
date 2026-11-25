import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { getPreferenceStorage } from './lib/storage';
import { applyDefaultViewOnStart } from './state/views';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true } },
});

// After a rebuild, an open tab asks for page files that no longer exist.
// Reload once to get the new ones; the guard stops a loop if the server is down.
globalThis.addEventListener('vite:preloadError', event => {
  const key = 'alert-center:chunk-reload';
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

// A server-backed preference store would load the user's preferences here.
await getPreferenceStorage().hydrate?.();
applyDefaultViewOnStart();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
