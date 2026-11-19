import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HeartbeatsResponse,
  Maintenance,
  MaintenancesResponse,
  MaintenanceTargetsResponse,
  NewMaintenanceRequest,
  OnCallResponse,
} from '../../shared/opsContext';
import type { WidgetId } from '../config/widgets';
import { useStore } from '../lib/store';
import { dashboardStore } from '../state/dashboard';
import { ApiRequestError } from './client';

/**
 * Maintenance windows, heartbeats and on-call. Each list is requested only
 * while its dashboard widget is switched on, so a user who does not show
 * them causes no Jira requests for them.
 */

async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, headers: { Accept: 'application/json', ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError('The Alert Center backend is not reachable. Is the server running?', null);
  }
  if (!response.ok) {
    let message = `The backend answered with status ${response.status}.`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') message = body.error;
    } catch {
      // not JSON
    }
    throw new ApiRequestError(message, response.status);
  }
  return (await response.json()) as T;
}

/** Same header as alert actions: the backend refuses writes without it. */
const WRITE_HEADERS = { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' };

/** True while the given widget is switched on in the dashboard layout. */
export function useWidgetOn(id: WidgetId): boolean {
  return useStore(dashboardStore).widgets.some((w) => w.id === id && w.visible);
}

const MAINTENANCES_KEY = ['ops', 'maintenances'] as const;

export function useMaintenances() {
  const on = useWidgetOn('maintenance');
  return useQuery({
    queryKey: MAINTENANCES_KEY,
    queryFn: ({ signal }) => request<MaintenancesResponse>('/api/ops/maintenances', {}, signal),
    enabled: on,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useMaintenanceTargets(enabled: boolean) {
  return useQuery({
    queryKey: ['ops', 'maintenance-targets'],
    queryFn: ({ signal }) => request<MaintenanceTargetsResponse>('/api/ops/maintenance-targets', {}, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useHeartbeats() {
  return useQuery({
    queryKey: ['ops', 'heartbeats'],
    queryFn: ({ signal }) => request<HeartbeatsResponse>('/api/ops/heartbeats', {}, signal),
    enabled: useWidgetOn('heartbeats'),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useOnCall() {
  return useQuery({
    queryKey: ['ops', 'on-call'],
    queryFn: ({ signal }) => request<OnCallResponse>('/api/ops/on-call', {}, signal),
    enabled: useWidgetOn('onCall'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useCreateMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NewMaintenanceRequest) =>
      request<Maintenance>('/api/maintenances', { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MAINTENANCES_KEY }),
  });
}

export function useCancelMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (m: Pick<Maintenance, 'id' | 'teamId'>) =>
      request<Maintenance>(`/api/maintenances/${encodeURIComponent(m.id)}/cancel`, {
        method: 'POST',
        headers: WRITE_HEADERS,
        body: JSON.stringify({ teamId: m.teamId }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MAINTENANCES_KEY }),
  });
}

/** Active maintenance covering an alert's integration, if any (only while the widget is on). */
export function useMaintenanceFor(integrationName: string | null): Maintenance | null {
  const { data } = useMaintenances();
  if (!data || !integrationName) return null;
  const hit = data.coverage.find((c) => c.integrationName.toLowerCase() === integrationName.toLowerCase());
  return hit ? (data.maintenances.find((m) => m.id === hit.maintenanceId) ?? null) : null;
}
