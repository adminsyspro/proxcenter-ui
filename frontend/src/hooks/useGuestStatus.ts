import { useMemo } from 'react'

import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

type GuestsResponse = { data?: { vms?: { connId?: string; vmid?: string | number; status?: string }[] } }

/**
 * Current status of every guest the user can see, keyed
 * `${connectionId}:${vmid}`, for the status dot of a guest glyph.
 */
export function useGuestStatus(): Record<string, string> {
  const refreshInterval = useRefreshInterval(60000)
  const { data } = useSWRFetch<GuestsResponse>('/api/v1/vms', { refreshInterval })

  return useMemo(() => {
    const map: Record<string, string> = {}

    for (const vm of data?.data?.vms || []) {
      if (vm.connId && vm.vmid !== undefined && vm.status) map[`${vm.connId}:${vm.vmid}`] = vm.status
    }

    return map
  }, [data])
}
