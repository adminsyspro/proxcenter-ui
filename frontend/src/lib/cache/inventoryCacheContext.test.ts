/**
 * Context-keying tests for the inventory SWR cache + inflight registry.
 * Contract: entries are keyed `${tenantId}::${vdcContext ?? 'all'}` — a
 * payload cached under a vDC context is NEVER served to the union view,
 * and invalidateInventoryCache(tenantId) purges every context of the tenant.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/cache/inventoryCacheContext.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getInflightFetch,
  getInventoryFromCache,
  getTenantInventoriesFromCache,
  invalidateInventoryCache,
  setCachedInventory,
  setInflightFetch,
} from './inventoryCache'

// `storages` is required truthy by getInventoryFromCache's pre-existing
// "missing required fields" guard (unrelated to context-keying) — included
// here so that guard never masks the assertions under test.
const payload = (tag: string) => ({ clusters: [{ id: tag }], storages: [] }) as any

beforeEach(() => {
  invalidateInventoryCache() // full flush of the globalThis store
})

describe('inventory cache context keying', () => {
  it('a payload cached under context vA is a MISS for the union view', () => {
    setCachedInventory(payload('narrowed'), 't1', 'vA')
    expect(getInventoryFromCache('t1', null).status).toBe('miss')
    expect(getInventoryFromCache('t1', 'vA')).toMatchObject({ status: 'fresh', data: payload('narrowed') })
  })

  it('union and context entries coexist independently', () => {
    setCachedInventory(payload('union'), 't2', null)
    setCachedInventory(payload('narrowed'), 't2', 'vA')
    expect(getInventoryFromCache('t2', null)).toMatchObject({ status: 'fresh', data: payload('union') })
    expect(getInventoryFromCache('t2', 'vA')).toMatchObject({ status: 'fresh', data: payload('narrowed') })
  })

  it('invalidateInventoryCache(tenantId) purges every context of that tenant only', () => {
    setCachedInventory(payload('union'), 't3', null)
    setCachedInventory(payload('narrowed'), 't3', 'vA')
    setCachedInventory(payload('other'), 't4', null)
    invalidateInventoryCache('t3')
    expect(getInventoryFromCache('t3', null).status).toBe('miss')
    expect(getInventoryFromCache('t3', 'vA').status).toBe('miss')
    expect(getInventoryFromCache('t4', null).status).toBe('fresh')
  })

  it('the inflight registry is keyed per context too', () => {
    const p = Promise.resolve(payload('x'))
    setInflightFetch(p, 't5', 'vA')
    expect(getInflightFetch('t5', null)).toBeNull()
    expect(getInflightFetch('t5', 'vA')).toBe(p)
    setInflightFetch(null, 't5', 'vA')
    expect(getInflightFetch('t5', 'vA')).toBeNull()
  })

  it('default (no vdcContext argument) behaves as the union — backward compatible', () => {
    setCachedInventory(payload('legacy'), 't6')
    expect(getInventoryFromCache('t6', null)).toMatchObject({ status: 'fresh' })
    expect(getInventoryFromCache('t6')).toMatchObject({ status: 'fresh' })
  })

  it('a payload cached under the union view is a MISS for a vDC context (anti-poisoning, reverse direction)', () => {
    setCachedInventory(payload('union-only'), 't7', null)
    expect(getInventoryFromCache('t7', 'vA').status).toBe('miss')
    expect(getInventoryFromCache('t7', null)).toMatchObject({ status: 'fresh', data: payload('union-only') })
  })
})

describe('getTenantInventoriesFromCache', () => {
  it('returns every warm context of a tenant, freshest first, excluding other tenants', async () => {
    setCachedInventory(payload('t8-union'), 't8', null)
    await new Promise(resolve => setTimeout(resolve, 5))
    setCachedInventory(payload('t8-vA'), 't8', 'vA')
    setCachedInventory(payload('t9-other-tenant'), 't9', null)

    const result = getTenantInventoriesFromCache('t8')
    expect(result).toEqual([payload('t8-vA'), payload('t8-union')])
  })

  it('returns an empty array when the tenant has no warm entry', () => {
    expect(getTenantInventoriesFromCache('t10')).toEqual([])
  })
})
