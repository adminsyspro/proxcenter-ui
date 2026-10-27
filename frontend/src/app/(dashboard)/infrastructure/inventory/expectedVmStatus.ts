// The status a power action from this tab leads to, held against the live
// stream until Proxmox reports it. /cluster/resources is refreshed by pvestatd
// about every 10 s, so the poll cycle a finished task triggers can still read
// the old status, and it sends that status along with any CPU or memory change
// of the guest: the tree turned a guest it had just stopped green again.

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import type { TreeCluster } from './InventoryTree'

/** Past this, the live status wins again, whatever it says (failed action). */
export const EXPECTED_STATUS_HOLD_MS = 30_000

export type ExpectedStatuses = Map<string, { status: string; until: number }>

export const expectedStatusKey = (connId: string, vmid: string | number) => `${connId}:${String(vmid)}`

export function expectStatus(expected: ExpectedStatuses, connId: string, vmid: string | number, status: string, now = Date.now()) {
  expected.set(expectedStatusKey(connId, vmid), { status, until: now + EXPECTED_STATUS_HOLD_MS })
}

/**
 * Returns the cycle's events with the expected status in place of the one a
 * vm:update read too early (its other fields still apply). A guest leaves the
 * map once the stream reports its expected status or the hold runs out.
 */
export function holdExpectedStatuses(events: InventoryEvent[], expected: ExpectedStatuses, now = Date.now()): InventoryEvent[] {
  if (expected.size === 0) return events

  return events.map(e => {
    if (e.event !== 'vm:update') return e
    const key = expectedStatusKey(e.connId, e.vmid)
    const hold = expected.get(key)
    if (!hold) return e
    if (e.status === hold.status || now > hold.until) {
      expected.delete(key)
      return e
    }
    return { ...e, status: hold.status }
  })
}

/**
 * The tree with one guest set to the status an action leads to. `type` narrows
 * the match when the caller knows it (tree menu); the details panel only has
 * the vmid. Untouched clusters and nodes keep their reference.
 */
export function withVmStatus(clusters: TreeCluster[], connId: string, vmid: string | number, status: string, type?: string): TreeCluster[] {
  const isGuest = (vm: TreeCluster['nodes'][number]['vms'][number]) => String(vm.vmid) === String(vmid) && (!type || vm.type === type)

  return clusters.map(clu => {
    if (clu.connId !== connId || !clu.nodes.some(n => n.vms.some(isGuest))) return clu
    const nodes = clu.nodes.map(n => n.vms.some(isGuest) ? { ...n, vms: n.vms.map(vm => isGuest(vm) ? { ...vm, status } : vm) } : n)
    return { ...clu, nodes }
  })
}
