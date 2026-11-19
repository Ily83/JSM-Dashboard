import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alert, SyncMeta } from '../../shared/types';
import { fetchAlertDetail, fetchAlerts, fetchStatus } from './client';

export interface AlertsData {
  version: string;
  alerts: Alert[];
  meta: SyncMeta;
}

const ALERTS_KEY = ['alerts'] as const;

/**
 * The alert list, polled in the background.
 *
 *  - One query feeds every section, KPI and filter: switching views or
 *    filters reads the cache and sends nothing.
 *  - Each poll tells the backend which version is already held. When nothing
 *    changed, the previous array is returned as-is, so memoised components
 *    (the table rows in particular) do not re-render.
 *  - Polling pauses while the browser tab is hidden.
 */
export function useAlerts(refreshSeconds: number) {
  const queryClient = useQueryClient();
  const forceNext = useRef(false);

  const query = useQuery<AlertsData>({
    queryKey: ALERTS_KEY,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<AlertsData>(ALERTS_KEY);
      const force = forceNext.current;
      forceNext.current = false;
      const response = await fetchAlerts({ knownVersion: previous?.version, force }, signal);
      if (response.unchanged && previous) return { ...previous, meta: response.meta };
      return { version: response.version, alerts: response.alerts, meta: response.meta };
    },
    refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    gcTime: Infinity,
    retry: 1,
  });

  const refetch = query.refetch;
  /** Manual refresh: asks the backend to synchronise now instead of using its cache. */
  const refresh = useCallback(() => {
    forceNext.current = true;
    void refetch();
  }, [refetch]);

  return { ...query, refresh };
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: ({ signal }) => fetchStatus(signal),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Description and extra properties of one alert. The key includes
 * `updatedAt`, so the detail is fetched again only when the alert changed.
 */
export function useAlertDetail(id: string | null, updatedAt: number | undefined) {
  return useQuery({
    queryKey: ['alert', id, updatedAt ?? 0],
    queryFn: ({ signal }) => fetchAlertDetail(id!, signal),
    enabled: id !== null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
