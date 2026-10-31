'use client'

import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import type { PoliciesResponse, WindowsResponse } from '../components/slaApi'
import { inventoryOptions, type InventoryOptions } from '../components/inventoryOptions'

import { availabilityErrorKind } from './errorKind'

const noRetryOnForbidden = (error: unknown, _key: string, _config: unknown, revalidate: (o: any) => void, opts: { retryCount: number }) => {
  if (availabilityErrorKind(error) === 'forbidden') return

  setTimeout(() => revalidate(opts), 5000 * (1 << Math.min(opts.retryCount, 6)))
}

/** One page of policies with their summary over 30 days. */
export function usePolicies(page: number) {
  return useSWRFetch<PoliciesResponse>(`/api/v1/sla/policies?period=30d&page=${page}`, {
    revalidateOnFocus: false,
    onErrorRetry: noRetryOnForbidden,
  })
}

/** One page of maintenance windows. */
export function useMaintenanceWindows(page: number) {
  return useSWRFetch<WindowsResponse>(`/api/v1/sla/maintenance-windows?page=${page}`, {
    revalidateOnFocus: false,
    onErrorRetry: noRetryOnForbidden,
  })
}

/** Every policy (id, name, enabled) in one light call, for the lists that name or pick one; shared by key. */
export function useAllPolicies(enabled: boolean) {
  return useSWRFetch<{ items: { id: string; name: string; enabled: boolean }[] }>(
    enabled ? '/api/v1/sla/policies?fields=names' : null,
    { revalidateOnFocus: false },
  )
}

const EMPTY: InventoryOptions = { connections: [], guests: [], tags: [], pools: [] }

/** Connections, nodes, guests, tags and pools of the inventory the tenant already sees; idle while `enabled` is false. */
export function useInventoryOptions(enabled: boolean) {
  const { data, error, isLoading } = useSWRFetch(enabled ? '/api/v1/inventory' : null, {
    // The tree is heavy: openings less than a minute apart share one GET. Past that, the next
    // opening refreshes, the cached copy being served while it does.
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  })

  const options = useMemo(() => (data ? inventoryOptions(data) : EMPTY), [data])

  return { options, error, isLoading }
}

/** The visible connections the registry measures, loaded while `enabled`. */
export function useMeasuredConnections(enabled: boolean) {
  return useSWRFetch<{ connectionIds: string[] }>(enabled ? '/api/v1/availability/measured' : null, { revalidateOnFocus: false })
}

/** One policy with one result per guest, named. */
export function usePolicyDetail(id: string | null) {
  return useSWRFetch<{
    to: string
    results: (import('@/lib/availability/types').Result & { name: string | null; type: 'qemu' | 'lxc' | null })[]
    /** Connection id to name, for the guests listed. */
    connectionNames?: Record<string, string>
  }>(
    id ? `/api/v1/sla/policies/${id}?period=30d` : null,
    { revalidateOnFocus: false },
  )
}
