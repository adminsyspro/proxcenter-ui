import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import type { PolicyGuest } from './zoneModel'

type VmsResponse = {
  data?: { vms?: { vmid?: string | number; name?: string; node?: string; type?: string; status?: string; template?: boolean; tags?: string[] }[] }
}

/**
 * The guests of a connection with their tags and status, from the inventory
 * route (one request, config-derived fields cached for 15 min server side).
 * Zone members are the guests tagged `<tag_prefix><zone name>`.
 */
export function useZoneGuests(connectionId: string) {
  const { data, error } = useSWRFetch<VmsResponse>(`/api/v1/vms?connId=${encodeURIComponent(connectionId)}`, { revalidateOnFocus: false })

  const guests = useMemo<PolicyGuest[]>(
    () => (data?.data?.vms ?? [])
      .filter(vm => !vm.template && vm.node && vm.vmid !== undefined)
      .map(vm => ({
        vmid: Number(vm.vmid),
        name: vm.name || `${vm.type}/${vm.vmid}`,
        node: vm.node as string,
        type: vm.type === 'lxc' ? 'lxc' : 'qemu',
        status: vm.status || 'unknown',
        tags: Array.isArray(vm.tags) ? vm.tags : [],
      })),
    [data],
  )

  const status: 'loading' | 'ready' | 'error' = data ? 'ready' : error ? 'error' : 'loading'
  return { guests, status }
}
