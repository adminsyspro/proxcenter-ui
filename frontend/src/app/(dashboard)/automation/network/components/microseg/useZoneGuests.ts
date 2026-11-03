import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import { COVERAGE_POLL_MS, firewallCoverageUrl, type FirewallCoverage } from '@/hooks/useZeroTrust'
import { zoneGuestsUrl } from '@/lib/microseg/runRefresh'

import type { PolicyGuest } from './zoneModel'

type VmsResponse = {
  data?: { vms?: { vmid?: string | number; name?: string; node?: string; type?: string; status?: string; template?: boolean; tags?: string[]; ips?: string[] }[] }
}

/** The inventory refused the session: it asks vm.view, which a user who only views the nodes does not have. */
const isForbidden = (error: unknown) => /\b403\b/.test(String((error as { message?: unknown } | undefined)?.message ?? ''))

/** While the coverage route is still computing and has no row yet, it is read again (each read joins the computation). */
const coveragePoll = (latest?: FirewallCoverage) => (latest?.computing && !latest.guests?.length ? COVERAGE_POLL_MS : 0)

/**
 * The guests of a connection with their tags and status, from the inventory
 * route (one request, config-derived fields cached for 15 min server side).
 * Zone members are the guests tagged `<tag_prefix><zone name>`; `ips` (config and last
 * known live addresses, never probed by this read) lets the map put an observed flow on its guests.
 *
 * The inventory asks vm.view, stricter than the firewall routes (node.view on the connection): a user who reads the
 * firewall but not the inventory gets a 403. The guests are then the rows of the firewall coverage route, the list
 * Firewalling shows that user (type, node, name, status, tags; cached and shared server side, no new Proxmox call
 * when it is warm). They carry no address, so observed flows are not put on guests for that user.
 */
export function useZoneGuests(connectionId: string) {
  const { data, error, mutate } = useSWRFetch<VmsResponse>(zoneGuestsUrl(connectionId), { revalidateOnFocus: false })
  const forbidden = !data && isForbidden(error)
  const coverage = useSWRFetch<FirewallCoverage>(forbidden && connectionId ? firewallCoverageUrl(connectionId) : null, {
    revalidateOnFocus: false,
    refreshInterval: coveragePoll,
  })
  const coverageRows = coverage.data?.computing && !coverage.data.guests?.length ? undefined : coverage.data?.guests

  const guests = useMemo<PolicyGuest[]>(() => {
    if (forbidden) {
      return (coverageRows ?? []).map(row => ({
        vmid: Number(row.vmid),
        name: row.name || `${row.type}/${row.vmid}`,
        node: row.node,
        type: row.type,
        status: row.status || 'unknown',
        tags: Array.isArray(row.tags) ? row.tags : [],
        ips: [],
      }))
    }
    return (data?.data?.vms ?? [])
      .filter(vm => !vm.template && vm.node && vm.vmid !== undefined)
      .map(vm => ({
        vmid: Number(vm.vmid),
        name: vm.name || `${vm.type}/${vm.vmid}`,
        node: vm.node as string,
        type: vm.type === 'lxc' ? 'lxc' : 'qemu',
        status: vm.status || 'unknown',
        tags: Array.isArray(vm.tags) ? vm.tags : [],
        ips: Array.isArray(vm.ips) ? vm.ips.filter(ip => typeof ip === 'string') : [],
      }))
  }, [data, forbidden, coverageRows])

  let status: 'loading' | 'ready' | 'error' = 'loading'
  if (data || (forbidden && coverageRows)) status = 'ready'
  else if ((error && !forbidden) || coverage.error) status = 'error'

  const reload = () => (forbidden ? coverage.mutate() : mutate())
  return { guests, status, reload }
}
