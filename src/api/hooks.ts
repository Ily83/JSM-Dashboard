import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ActionId, AlertAction } from '../../shared/actions';
import type { Alert, SyncMeta } from '../../shared/types';
import {
  fetchAlertDetail,
  fetchAlerts,
  fetchAttachments,
  fetchEscalations,
  fetchLogs,
  fetchMe,
  fetchNotes,
  fetchSchedules,
  fetchStatus,
  fetchTeams,
  postAction,
  searchUsers,
  type ActionResponse,
} from './client';

export interface AlertsData {
  version: string;
  alerts: Alert[];
  meta: SyncMeta;
}

const ALERTS_KEY = ['alerts'] as const;

/** Milliseconds between polls: the auto-refresh setting, else every minute when polling must continue, else none. */
function pollInterval(refreshSeconds: number, keepPollingInBackground: boolean): number | false {
  if (refreshSeconds > 0) return refreshSeconds * 1000;
  return keepPollingInBackground ? 60_000 : false;
}

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
export function useAlerts(refreshSeconds: number, enabled = true, keepPollingInBackground = false) {
  const queryClient = useQueryClient();
  const forceNext = useRef(false);

  const query = useQuery<AlertsData>({
    queryKey: ALERTS_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<AlertsData>(ALERTS_KEY);
      const force = forceNext.current;
      forceNext.current = false;
      const response = await fetchAlerts({ knownVersion: previous?.version, force }, signal);
      if (response.unchanged && previous) return { ...previous, meta: response.meta };
      return { version: response.version, alerts: response.alerts, meta: response.meta };
    },
    // The P1 alarm needs polling to continue while the tab is hidden, and
    // even with auto-refresh off (then every 60 seconds).
    refetchInterval: pollInterval(refreshSeconds, keepPollingInBackground),
    refetchIntervalInBackground: keepPollingInBackground,
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

// ---- Write actions ----------------------------------------------------------

const NO_ACTIONS: ActionId[] = [];

/** The write actions this backend accepts; empty while loading or when read-only. */
export function useWriteActions(): ReadonlySet<ActionId> {
  const status = useStatus();
  const actions = status.data?.writes.enabled ? status.data.writes.actions : NO_ACTIONS;
  return useStableSet(actions);
}

const setCache = new WeakMap<readonly ActionId[], ReadonlySet<ActionId>>();
function useStableSet(list: readonly ActionId[]): ReadonlySet<ActionId> {
  let set = setCache.get(list);
  if (!set) {
    set = new Set(list);
    setCache.set(list, set);
  }
  return set;
}

/**
 * Puts the alert returned after an action into the cached list straight
 * away, then lets the next poll (asked for now) bring the authoritative list.
 */
export function applyActionResult(queryClient: QueryClient, id: string, response: ActionResponse): void {
  const updated = response.alert;
  if (updated) {
    queryClient.setQueryData<AlertsData>(ALERTS_KEY, (data) => {
      if (!data) return data;
      const { description: _d, rawTags: _r, extraProperties: _e, actions: _a, seen: _s, detailLoaded: _l, detailError: _x, ...row } = updated;
      return { ...data, alerts: data.alerts.map((a) => (a.id === id ? row : a)) };
    });
  }
  void queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['alert', id] });
  void queryClient.invalidateQueries({ queryKey: ['alert-notes', id] });
  void queryClient.invalidateQueries({ queryKey: ['alert-logs', id] });
}

/** One action on one alert. */
export function useAlertAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AlertAction) => postAction(id, action),
    onSuccess: (response) => applyActionResult(queryClient, id, response),
  });
}

// ---- Notes, activity, attachments, directory --------------------------------

export function useNotes(id: string) {
  return useQuery({ queryKey: ['alert-notes', id], queryFn: ({ signal }) => fetchNotes(id, signal), staleTime: 30_000, retry: 1 });
}

export function useLogs(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['alert-logs', id], queryFn: ({ signal }) => fetchLogs(id, signal), enabled, staleTime: 30_000, retry: 1 });
}

export function useAttachments(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['alert-attachments', id], queryFn: ({ signal }) => fetchAttachments(id, signal), enabled, staleTime: 60_000, retry: 1 });
}

const DIRECTORY = { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1 } as const;

export function useMe(enabled = true) {
  return useQuery({ queryKey: ['directory', 'me'], queryFn: ({ signal }) => fetchMe(signal), enabled, ...DIRECTORY });
}

export function useUserSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['directory', 'users', trimmed.toLowerCase()],
    queryFn: ({ signal }) => searchUsers(trimmed, signal),
    enabled: trimmed.length >= 2,
    ...DIRECTORY,
  });
}

export function useTeams(enabled = true) {
  return useQuery({ queryKey: ['directory', 'teams'], queryFn: ({ signal }) => fetchTeams(signal), enabled, ...DIRECTORY });
}

export function useSchedules(enabled = true) {
  return useQuery({ queryKey: ['directory', 'schedules'], queryFn: ({ signal }) => fetchSchedules(signal), enabled, ...DIRECTORY });
}

export function useEscalations(teamIds: readonly string[], enabled = true) {
  return useQuery({
    queryKey: ['directory', 'escalations', [...teamIds].sort((a, b) => a.localeCompare(b)).join(',')],
    queryFn: async ({ signal }) => {
      const lists = await Promise.all(teamIds.map((teamId) => fetchEscalations(teamId, signal).catch(() => [])));
      const byId = new Map(lists.flat().map((e) => [e.id, e]));
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: enabled && teamIds.length > 0,
    ...DIRECTORY,
  });
}
