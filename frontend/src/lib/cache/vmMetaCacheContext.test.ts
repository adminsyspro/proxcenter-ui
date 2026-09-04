/**
 * Regression test for issue #633's new failure mode: with an active vDC
 * view context, every browser inventory read now warms `t::<vdcId>` and
 * the union key (`t::all`) can stay cold or go stale. vmMetaCache must
 * still resolve tag/pool metadata by merging every warm context of the
 * tenant (getTenantInventoriesFromCache), not just the union key, or
 * tag/pool-scoped RBAC grants and alert visibility silently fail closed.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/cache/vmMetaCacheContext.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { invalidateInventoryCache, setCachedInventory } from './inventoryCache'
import { resolveVmMeta } from './vmMetaCache'

const guest = (vmid: number, tags: string, pool?: string) => ({
  vmid,
  type: 'qemu',
  status: 'running',
  tags,
  pool,
})

const inventory = (guests: any[]) =>
  ({
    clusters: [{ id: 'conn-1', name: 'C1', nodes: [{ node: 'n1', status: 'online', guests }] }],
    pbsServers: [],
    externalHypervisors: [],
    storages: [],
    stats: {
      totalClusters: 1,
      totalNodes: 1,
      totalGuests: guests.length,
      onlineNodes: 1,
      runningGuests: guests.length,
      totalPbsServers: 0,
      totalDatastores: 0,
      totalBackups: 0,
    },
  }) as any

beforeEach(() => {
  invalidateInventoryCache()
})

describe('vmMetaCache — context-keyed cache coverage (issue #633)', () => {
  it('resolves meta from a context-keyed entry while the union key is cold', () => {
    setCachedInventory(inventory([guest(100, 'prod;web', 'pool-a')]), 'tA', 'vA')
    // The union key ('tA::all') was never warmed — only 'tA::vA' exists.
    const meta = resolveVmMeta('conn-1:n1:qemu:100', 'tA')
    expect(meta).toEqual({ tags: ['prod', 'web'], pool: 'pool-a', node: 'n1' })
  })

  it('merges guests across contexts and the freshest entry wins a per-VM conflict', async () => {
    setCachedInventory(inventory([guest(100, 'stale-tag')]), 'tB', null)
    await new Promise(resolve => setTimeout(resolve, 5))
    setCachedInventory(inventory([guest(100, 'fresh-tag'), guest(200, 'only-in-vA')]), 'tB', 'vA')

    expect(resolveVmMeta('conn-1:n1:qemu:100', 'tB')).toEqual({ tags: ['fresh-tag'], pool: undefined, node: 'n1' })
    expect(resolveVmMeta('conn-1:n1:qemu:200', 'tB')).toEqual({ tags: ['only-in-vA'], pool: undefined, node: 'n1' })
  })

  it('returns null when no context is warm for the tenant (cold cache, safe denial)', () => {
    expect(resolveVmMeta('conn-1:n1:qemu:100', 'tC')).toBeNull()
  })
})
