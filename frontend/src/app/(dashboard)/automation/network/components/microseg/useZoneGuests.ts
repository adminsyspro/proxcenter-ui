import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import { zoneGuestsUrl } from '@/lib/microseg/runRefresh'

import type { PolicyGuest } from './zoneModel'

type VmsResponse = {
  data?: { vms?: { vmid?: string | number; name?: string; node?: string; type?: string; status?: string; template?: boolean; tags?: string[]; ips?: string[] }[] }
}

/**
 * The guests of a connection with their tags and status, from the inventory
 * route (one request, config-derived fields cached for 15 min server side).
 * Zone members are the guests tagged `<tag_prefix><zone name>`; `ips` (config and last
 * known live addresses, never probed by this read) lets the map put an observed flow on its guests.
 */
export function useZoneGuests(connectionId: string) {
  const { data, error, mutate } = useSWRFetch<VmsResponse>(zoneGuestsUrl(connectionId), { revalidateOnFocus: false })

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
        ips: Array.isArray(vm.ips) ? vm.ips.filter(ip => typeof ip === 'string') : [],
      })),
    [data],
  )

  const status: 'loading' | 'ready' | 'error' = data ? 'ready' : error ? 'error' : 'loading'
  return { guests, status, reload: () => mutate() }
}
