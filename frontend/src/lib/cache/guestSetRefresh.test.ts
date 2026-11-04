import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { refreshCachedGuests } from './guestSetRefresh'
import { forgetCachedGuest, getInventoryFromCache, invalidateInventoryCache, setCachedInventory } from './inventoryCache'

const conn = { baseUrl: 'https://pve.local:8006', apiToken: 'tok', id: 'connA' }

function seed() {
  setCachedInventory({
    clusters: [{ id: 'connA', nodes: [{ node: 'n1', status: 'online', guests: [{ vmid: 100, type: 'qemu', node: 'n1', status: 'running', name: 'a', template: false }] }] }],
    pbsServers: [], externalHypervisors: [], storageResources: [],
    stats: { totalClusters: 1, totalNodes: 1, totalGuests: 1, onlineNodes: 1, runningGuests: 1, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
  } as any)
}
function cachedVmids() {
  const hit = getInventoryFromCache()
  return hit.status === 'miss' ? null : hit.data.clusters[0].nodes.flatMap((n: any) => n.guests.map((g: any) => g.vmid))
}

beforeEach(() => {
  pveFetchMock.mockReset()
  invalidateInventoryCache()
  ;(globalThis as any).__proxcenter_inventory_tombstones__?.clear()
})

describe('refreshCachedGuests', () => {
  it('reads the guest list of the connection once and patches the cache with it', async () => {
    seed()
    pveFetchMock.mockResolvedValue([
      { vmid: 100, type: 'qemu', node: 'n1', status: 'running', name: 'a' },
      { vmid: 101, type: 'qemu', node: 'n1', status: 'stopped', name: 'clone', lock: 'clone' },
    ])
    await refreshCachedGuests('connA', conn)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock).toHaveBeenCalledWith(conn, '/cluster/resources?type=vm')
    expect(cachedVmids()).toEqual([100, 101])
  })

  it('costs no Proxmox call when no cached inventory holds the connection', async () => {
    await refreshCachedGuests('connA', conn)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('shows a new guest that reuses a vmid ProxCenter destroyed a moment ago', async () => {
    seed()
    forgetCachedGuest('connA', 'qemu', 100)
    pveFetchMock.mockResolvedValue([{ vmid: 100, type: 'qemu', node: 'n1', status: 'stopped', name: 'restored', lock: 'create' }])
    await refreshCachedGuests('connA', conn, { type: 'qemu', vmid: '100' })
    expect(cachedVmids()).toEqual([100])
  })

  it('swallows a failed read: the action itself succeeded', async () => {
    seed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pveFetchMock.mockRejectedValue(new Error('down'))
    await expect(refreshCachedGuests('connA', conn)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(cachedVmids()).toEqual([100])
  })
})
