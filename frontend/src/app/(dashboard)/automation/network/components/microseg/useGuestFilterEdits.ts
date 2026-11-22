'use client'

import { useCallback, useMemo } from 'react'
import { useSWRConfig } from 'swr'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { ipFilterKey } from '@/lib/microseg/useMicrosegLists'
import type { GuestIPFilter, MicrosegPolicy } from '@/lib/microseg/types'

import { guestFiltersOf, withAllowedAddress, withGuestFilter, type FilterGuestRef, type GuestFilterPatch } from './ipFilterModel'

/**
 * The writes of the per-guest settings of the IP filter: a PUT /policy that carries the WHOLE list (read from the draft,
 * the guest's entry replaced) and the draft version, through the connection the policy was read from. A draft change:
 * nothing goes to Proxmox before the next apply. After the write, success or not, the draft, the status and the filter
 * of the guest's cluster are read again (a VERSION_CONFLICT included), and a failure is rethrown: the caller says why.
 */
export function useGuestFilterEdits(connectionId: string, policy: MicrosegPolicy, reloadPolicy: () => Promise<unknown>) {
  const { mutate } = useSWRConfig()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const { version } = policy
  const filters = useMemo(() => guestFiltersOf(policy), [policy])

  const send = useCallback(async (next: GuestIPFilter[], cluster: string) => {
    try {
      await api.savePolicy({ version, guest_filters: next })
    } finally {
      await Promise.all([
        reloadPolicy().catch(() => undefined),
        Promise.resolve(mutate(`${microsegBaseUrl(connectionId)}/status`)).catch(() => undefined),
        Promise.resolve(mutate(ipFilterKey(cluster))).catch(() => undefined),
      ])
    }
  }, [api, version, reloadPolicy, mutate, connectionId])

  /** Leaves the guest without the filter (or not), or replaces its additional addresses. */
  const change = useCallback((guest: FilterGuestRef, patch: GuestFilterPatch) => send(withGuestFilter(filters, guest, patch, connectionId), guest.connectionId), [send, filters, connectionId])

  /** Adds an address the engine held back to the additional addresses of the guest. */
  const allow = useCallback((guest: FilterGuestRef, addr: string) => send(withAllowedAddress(filters, guest, addr, connectionId), guest.connectionId), [send, filters, connectionId])

  return { filters, change, allow }
}

export type GuestFilterEdits = ReturnType<typeof useGuestFilterEdits>
