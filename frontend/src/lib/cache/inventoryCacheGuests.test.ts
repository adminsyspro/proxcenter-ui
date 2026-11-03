/**
 * roadmap#192: a guest destroyed in Proxmox came back on every reload for as
 * long as the cached inventory stayed fresh (2 min), because nothing but the
 * TTL ever corrected a cache entry. The poller and the mutation routes now
 * patch the guest set of every cached inventory holding the connection.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearGuestTombstone,
  forgetCachedGuest,
  getInventoryFromCache,
  hasCachedConnection,
  invalidateInventoryCache,
  reconcileCachedGuests,
  setCachedInventory,
} from './inventoryCache'

const guest = (vmid: number, node: string, extra: Record<string, unknown> = {}) => ({
  vmid, name: `vm-${vmid}`, type: 'qemu', status: 'running', node, template: false, ...extra,
})
const row = (vmid: number, node: string, extra: Record<string, unknown> = {}) => ({
  vmid, name: `vm-${vmid}`, type: 'qemu', status: 'running', node, ...extra,
})

function inventory() {
  return {
    clusters: [
      {
        id: 'connA',
        name: 'A',
        nodes: [
          { node: 'n1', status: 'online', guests: [guest(100, 'n1', { diskTotal: 42, hastate: 'started' }), guest(101, 'n1')] },
          { node: 'n2', status: 'online', guests: [guest(200, 'n2', { status: 'stopped' })] },
        ],
      },
      { id: 'connB', name: 'B', nodes: [{ node: 'b1', status: 'online', guests: [guest(100, 'b1')] }] },
    ],
    pbsServers: [],
    externalHypervisors: [],
    storageResources: [],
    stats: { totalClusters: 2, totalNodes: 3, totalGuests: 4, onlineNodes: 3, runningGuests: 3, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
  } as any
}

function cached(tenantId = 'default', vdc: string | null = null): any {
  const hit = getInventoryFromCache(tenantId, vdc)
  if (hit.status === 'miss') throw new Error('cache miss')
  return hit.data
}
const guestsOf = (data: any, connId: string) =>
  data.clusters.find((c: any) => c.id === connId).nodes.flatMap((n: any) => n.guests.map((g: any) => `${n.node}:${g.vmid}`))

beforeEach(() => {
  invalidateInventoryCache()
  ;(globalThis as any).__proxcenter_inventory_tombstones__?.clear()
})

describe('reconcileCachedGuests', () => {
  it('drops a guest Proxmox no longer lists, in every tenant and vDC context', () => {
    setCachedInventory(inventory(), 'default')
    setCachedInventory(inventory(), 'tenant-2', 'vdc-1')
    reconcileCachedGuests('connA', [row(100, 'n1'), row(200, 'n2', { status: 'stopped' })])
    for (const data of [cached('default'), cached('tenant-2', 'vdc-1')]) {
      expect(guestsOf(data, 'connA')).toEqual(['n1:100', 'n2:200'])
      expect(data.stats.totalGuests).toBe(3)
      expect(data.stats.runningGuests).toBe(2)
    }
  })

  it('leaves the other connections alone, even on a shared vmid', () => {
    setCachedInventory(inventory())
    reconcileCachedGuests('connA', [])
    expect(guestsOf(cached(), 'connB')).toEqual(['b1:100'])
  })

  it('adds a guest the cache does not know, sorted by vmid', () => {
    setCachedInventory(inventory())
    reconcileCachedGuests('connA', [row(100, 'n1'), row(101, 'n1'), row(200, 'n2'), row(150, 'n1', { template: 1, pool: 'p1', tags: 'a;b', lock: 'clone' })])
    const data = cached()
    expect(guestsOf(data, 'connA')).toEqual(['n1:100', 'n1:101', 'n1:150', 'n2:200'])
    const added = data.clusters[0].nodes[0].guests[2]
    expect(added).toMatchObject({ vmid: 150, type: 'qemu', node: 'n1', template: true, pool: 'p1', tags: 'a;b', lock: 'clone' })
  })

  it('names an unnamed new guest the way the producers do, and keeps unknown types out', () => {
    setCachedInventory(inventory())
    reconcileCachedGuests('connA', [
      row(100, 'n1'), row(101, 'n1'), row(200, 'n2'),
      { vmid: 300, type: 'lxc', node: 'n2' },
      { vmid: 400, type: 'storage', node: 'n2' },
      { vmid: 500, type: 'qemu' },
    ] as any)
    const added = cached().clusters[0].nodes[1].guests.find((g: any) => g.vmid === 300)
    expect(added).toMatchObject({ name: 'lxc/300', status: 'unknown' })
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n1:101', 'n2:200', 'n2:300'])
  })

  it('moves a relocated guest and keeps what only the full read knows', () => {
    setCachedInventory(inventory())
    reconcileCachedGuests('connA', [row(100, 'n2', { status: 'stopped' }), row(101, 'n1'), row(200, 'n2')])
    const data = cached()
    expect(guestsOf(data, 'connA')).toEqual(['n1:101', 'n2:100', 'n2:200'])
    expect(data.clusters[0].nodes[1].guests[0]).toMatchObject({ node: 'n2', status: 'stopped', diskTotal: 42, hastate: 'started' })
  })

  it('creates the node of a guest that lands on a node the cache never saw', () => {
    setCachedInventory(inventory())
    reconcileCachedGuests('connA', [row(100, 'n1'), row(101, 'n1'), row(200, 'n0')])
    const nodes = cached().clusters[0].nodes
    expect(nodes.map((n: any) => n.node)).toEqual(['n0', 'n1', 'n2'])
    expect(nodes[0]).toMatchObject({ status: 'unknown', guests: [expect.objectContaining({ vmid: 200 })] })
  })

  it('keeps the entry untouched when nothing changed', () => {
    setCachedInventory(inventory())
    const before = cached()
    reconcileCachedGuests('connA', [row(100, 'n1', { cpu: 0.5 }), row(101, 'n1'), row(200, 'n2', { status: 'stopped' })])
    expect(cached()).toBe(before)
  })

  it('never patches a cluster whose read failed, nor an entry of an older payload version', () => {
    const data = inventory()
    data.clusters[0] = { id: 'connA', name: 'A', status: 'offline', nodes: [] }
    setCachedInventory(data)
    const store = (globalThis as any).__proxcenter_inventory_cache__ as Map<string, any>
    store.set('old::all', { data: inventory(), timestamp: Date.now(), version: 1 })
    reconcileCachedGuests('connA', [row(999, 'n1')])
    expect(cached().clusters[0].nodes).toEqual([])
    expect(guestsOf(store.get('old::all').data, 'connA')).toEqual(['n1:100', 'n1:101', 'n2:200'])
  })

  it('does not change the freshness of the entry', () => {
    setCachedInventory(inventory())
    const store = (globalThis as any).__proxcenter_inventory_cache__ as Map<string, any>
    store.get('default::all').timestamp = Date.now() - 3 * 60_000
    reconcileCachedGuests('connA', [])
    expect(getInventoryFromCache().status).toBe('stale')
  })
})

describe('forgetCachedGuest', () => {
  it('removes the guest at once from every cached inventory', () => {
    setCachedInventory(inventory())
    setCachedInventory(inventory(), 'tenant-2')
    forgetCachedGuest('connA', 'qemu', '101')
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n2:200'])
    expect(guestsOf(cached('tenant-2'), 'connA')).toEqual(['n1:100', 'n2:200'])
    expect(cached().stats.totalGuests).toBe(3)
  })

  it('keeps the guest out of a fetch that read Proxmox while the destroy task ran', () => {
    forgetCachedGuest('connA', 'qemu', 101)
    setCachedInventory(inventory())
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n2:200'])
    expect(guestsOf(cached(), 'connB')).toEqual(['b1:100'])
  })

  it('keeps it out of a poll that still lists it, until a poll shows it gone', () => {
    setCachedInventory(inventory())
    forgetCachedGuest('connA', 'qemu', 101)
    reconcileCachedGuests('connA', [row(100, 'n1'), row(101, 'n1', { lock: 'destroyed' }), row(200, 'n2')])
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n2:200'])
    reconcileCachedGuests('connA', [row(100, 'n1'), row(200, 'n2')])
    // The vmid is free again: a new guest taking it shows on the next poll.
    reconcileCachedGuests('connA', [row(100, 'n1'), row(101, 'n2'), row(200, 'n2')])
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n2:101', 'n2:200'])
  })

  it('lets a guest that reuses the vmid show once its creation is known', () => {
    forgetCachedGuest('connA', 'qemu', 101)
    clearGuestTombstone('connA', 'qemu', 101)
    setCachedInventory(inventory())
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n1:101', 'n2:200'])
  })

  it('forgets the tombstone once the fresh window is over', () => {
    forgetCachedGuest('connA', 'qemu', 101)
    const tombstones = (globalThis as any).__proxcenter_inventory_tombstones__ as Map<string, number>
    for (const key of tombstones.keys()) tombstones.set(key, Date.now() - 1)
    setCachedInventory(inventory())
    expect(guestsOf(cached(), 'connA')).toEqual(['n1:100', 'n1:101', 'n2:200'])
    expect(tombstones.size).toBe(0)
  })

  it('is a no-op on a guest no cached inventory holds', () => {
    setCachedInventory(inventory())
    const before = cached()
    forgetCachedGuest('connA', 'lxc', 101)
    expect(cached()).toBe(before)
  })
})

describe('hasCachedConnection', () => {
  it('tells whether any cached inventory holds the connection', () => {
    expect(hasCachedConnection('connA')).toBe(false)
    setCachedInventory(inventory(), 'tenant-2', 'vdc-1')
    expect(hasCachedConnection('connA')).toBe(true)
    expect(hasCachedConnection('connZ')).toBe(false)
  })
})
