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

async function start(): Promise<void> {
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
}

void start();
