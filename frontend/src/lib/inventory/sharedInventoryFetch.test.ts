import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearInflightFetch,
  getInflightFetch,
  getInventoryFromCache,
  invalidateInventoryCache,
  inventoryCacheEpoch,
  setCachedInventory,
  setInflightFetch,
  type CachedInventory,
} from '@/lib/cache/inventoryCache'

import { getSharedInventoryFetch, joinOrStartInventoryFetch, type InventoryFetchEvent, type InventoryProducer } from './sharedInventoryFetch'

function inventory(tag: string): CachedInventory {
  return {
    clusters: [{ id: tag }],
    pbsServers: [],
    externalHypervisors: [],
    stats: { totalClusters: 1, totalNodes: 0, totalGuests: 0, onlineNodes: 0, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
  }
}

/** A producer the test drives by hand: emit, then finish or fail. */
function manualProducer() {
  let emit!: (e: InventoryFetchEvent) => void
  let finish!: (data: CachedInventory) => void
  let fail!: (err: Error) => void
  const produce = vi.fn<InventoryProducer>(e => {
    emit = e
    return new Promise<CachedInventory>((resolve, reject) => { finish = resolve; fail = reject })
  })
  return { produce, emit: (e: InventoryFetchEvent) => emit(e), finish: (d: CachedInventory) => finish(d), fail: (e: Error) => fail(e) }
}

const cluster = (id: string): InventoryFetchEvent => ({ kind: 'cluster', data: { id } })

beforeEach(() => {
  invalidateInventoryCache()
})

describe('joinOrStartInventoryFetch', () => {
  it('runs one producer for every reader of a scope, replaying what a late reader missed', async () => {
    const p = manualProducer()
    const first = joinOrStartInventoryFetch('t1', null, p.produce)
    const seenFirst: InventoryFetchEvent[] = []
    first.subscribe(e => seenFirst.push(e))
    p.emit(cluster('a'))

    const second = joinOrStartInventoryFetch('t1', null, vi.fn())
    const seenSecond: InventoryFetchEvent[] = []
    second.subscribe(e => seenSecond.push(e))
    p.emit(cluster('b'))
    p.finish(inventory('done'))

    expect(second).toBe(first)
    expect(p.produce).toHaveBeenCalledTimes(1)
    await expect(second.result).resolves.toEqual(inventory('done'))
    expect(seenFirst).toEqual([cluster('a'), cluster('b')])
    expect(seenSecond).toEqual([cluster('a'), cluster('b')])
  })

  it('caches the result under the scope key and frees the slot', async () => {
    const p = manualProducer()
    const shared = joinOrStartInventoryFetch('t1', 'vdc-a', p.produce)
    p.finish(inventory('x'))
    await shared.result

    expect(getInventoryFromCache('t1', 'vdc-a')).toEqual({ status: 'fresh', data: inventory('x') })
    expect(getInventoryFromCache('t1', null)).toEqual({ status: 'miss' })
    expect(getSharedInventoryFetch('t1', 'vdc-a')).toBeNull()
    expect(getInflightFetch('t1', 'vdc-a')).toBeNull()
  })

  it('keeps tenants and vDC contexts apart', () => {
    const produce = () => new Promise<CachedInventory>(() => {})
    const a = joinOrStartInventoryFetch('t1', null, produce)
    const b = joinOrStartInventoryFetch('t2', null, produce)
    const c = joinOrStartInventoryFetch('t1', 'vdc-a', produce)

    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('parks its result in the shared in-flight slot, for a blocking /api/v1/inventory read', async () => {
    const p = manualProducer()
    const shared = joinOrStartInventoryFetch('t1', null, p.produce)

    expect(getInflightFetch('t1', null)).toBe(shared.result)
    p.finish(inventory('x'))
    await expect(getInflightFetch('t1', null)).resolves.toEqual(inventory('x'))
  })

  it('force starts a new fan-out; the old one ending does not free the new one', async () => {
    const old = manualProducer()
    const fresh = manualProducer()
    const first = joinOrStartInventoryFetch('t1', null, old.produce)
    const forced = joinOrStartInventoryFetch('t1', null, fresh.produce, { force: true })

    expect(forced).not.toBe(first)
    old.finish(inventory('old'))
    await first.result

    expect(getSharedInventoryFetch('t1', null)).toBe(forced)
    expect(getInflightFetch('t1', null)).toBe(forced.result)
    expect(joinOrStartInventoryFetch('t1', null, vi.fn())).toBe(forced)
  })

  it('a fan-out started before an invalidation neither caches its result nor takes new readers', async () => {
    const before = manualProducer()
    const after = manualProducer()
    const first = joinOrStartInventoryFetch('t1', null, before.produce)

    invalidateInventoryCache()
    const second = joinOrStartInventoryFetch('t1', null, after.produce)
    before.finish(inventory('pre-action'))
    await first.result

    expect(second).not.toBe(first)
    expect(getInventoryFromCache('t1', null)).toEqual({ status: 'miss' })
    after.finish(inventory('post-action'))
    await second.result
    expect(getInventoryFromCache('t1', null)).toEqual({ status: 'fresh', data: inventory('post-action') })
  })

  it('a failed fan-out rejects for its readers and lets the next one start over', async () => {
    const p = manualProducer()
    const shared = joinOrStartInventoryFetch('t1', null, p.produce)
    p.fail(new Error('pveproxy down'))

    await expect(shared.result).rejects.toThrow('pveproxy down')
    expect(getSharedInventoryFetch('t1', null)).toBeNull()
    expect(getInflightFetch('t1', null)).toBeNull()
    const retry = manualProducer()
    joinOrStartInventoryFetch('t1', null, retry.produce)
    expect(retry.produce).toHaveBeenCalledTimes(1)
  })

  it('a reader that throws does not starve the others, and an unsubscribed one hears nothing more', async () => {
    const p = manualProducer()
    const shared = joinOrStartInventoryFetch('t1', null, p.produce)
    const seen: string[] = []
    shared.subscribe(() => { throw new Error('reader bug') })
    const unsubscribe = shared.subscribe(e => seen.push(`gone:${(e as any).data.id}`))
    shared.subscribe(e => seen.push(`kept:${(e as any).data.id}`))

    p.emit(cluster('a'))
    unsubscribe()
    p.emit(cluster('b'))

    expect(seen).toEqual(['gone:a', 'kept:a', 'kept:b'])
  })
})

describe('inventory cache epoch', () => {
  it('drops a write from a fetch that started before an invalidation', () => {
    const epoch = inventoryCacheEpoch()
    invalidateInventoryCache('t1')

    setCachedInventory(inventory('late'), 't1', null, epoch)
    expect(getInventoryFromCache('t1', null)).toEqual({ status: 'miss' })

    setCachedInventory(inventory('current'), 't1', null, inventoryCacheEpoch())
    expect(getInventoryFromCache('t1', null).status).toBe('fresh')
  })

  it('invalidation empties the in-flight slots of the tenant only', () => {
    const p1 = new Promise<CachedInventory>(() => {})
    const p2 = new Promise<CachedInventory>(() => {})
    setInflightFetch(p1, 't1', null)
    setInflightFetch(p2, 't2', null)

    invalidateInventoryCache('t1')

    expect(getInflightFetch('t1', null)).toBeNull()
    expect(getInflightFetch('t2', null)).toBe(p2)
  })

  it('clearInflightFetch frees the slot only for the promise that holds it', () => {
    const older = new Promise<CachedInventory>(() => {})
    const newer = new Promise<CachedInventory>(() => {})
    setInflightFetch(newer, 't1', null)

    clearInflightFetch(older, 't1', null)
    expect(getInflightFetch('t1', null)).toBe(newer)
    clearInflightFetch(newer, 't1', null)
    expect(getInflightFetch('t1', null)).toBeNull()
  })
})
