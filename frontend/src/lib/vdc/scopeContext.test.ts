/**
 * MOCK-based tests for the vDC-context narrowing in getVdcScope:
 * - context → the vdc findMany gains id: <vdcId>, Sets reduced to that vDC
 * - no context → union (current behavior)
 * - ignoreVdcContext → getVdcContext never consulted (authorization callers)
 * - cache keys are per-(tenant, context): no cross-context poisoning
 * - clearVdcScopeCache(tenantId) purges EVERY context entry of the tenant
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/vdc/scopeContext.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { vdcFindManyMock, getVdcContextMock } = vi.hoisted(() => ({
  vdcFindManyMock: vi.fn(),
  getVdcContextMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { vdc: { findMany: vdcFindManyMock } } }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('./context', () => ({ getVdcContext: getVdcContextMock, clearVdcContextCache: vi.fn() }))

import { clearVdcScopeCache, getVdcScope } from './scope'

// Minimal vdc row shape consumed by buildVdcScope (scope.ts:104-120).
const row = (id: string, connectionId: string) => ({
  id,
  connectionId,
  pvePoolName: `pool-${id}`,
  primaryStorage: null,
  nodes: [{ nodeName: `node-${id}` }],
  storages: [],
  vnets: [],
  sharedBridges: [],
  pbsNamespaces: [],
  storagePolicies: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  clearVdcScopeCache() // flush the module-level cache between cases
  getVdcContextMock.mockResolvedValue(null)
  vdcFindManyMock.mockResolvedValue([row('vA', 'conn-A'), row('vB', 'conn-B')])
})

describe('getVdcScope narrowing', () => {
  it('no context → union of the tenant vDCs (both connections present)', async () => {
    const scope = await getVdcScope('t1')
    expect(scope!.connectionIds).toEqual(new Set(['conn-A', 'conn-B']))
    expect(vdcFindManyMock.mock.calls[0][0].where).toEqual({ tenantId: 't1', enabled: true })
  })

  it('context vA → the findMany where gains id: vA', async () => {
    getVdcContextMock.mockResolvedValue('vA')
    vdcFindManyMock.mockResolvedValue([row('vA', 'conn-A')])
    const scope = await getVdcScope('t1')
    expect(vdcFindManyMock.mock.calls[0][0].where).toEqual({ tenantId: 't1', enabled: true, id: 'vA' })
    expect(scope!.connectionIds).toEqual(new Set(['conn-A']))
  })

  it('ignoreVdcContext skips the cookie read entirely (authorization callers)', async () => {
    await getVdcScope('t1', { ignoreVdcContext: true })
    expect(getVdcContextMock).not.toHaveBeenCalled()
  })

  it('provider short-circuit unchanged: null, no context read, no query', async () => {
    await expect(getVdcScope('default')).resolves.toBeNull()
    expect(getVdcContextMock).not.toHaveBeenCalled()
    expect(vdcFindManyMock).not.toHaveBeenCalled()
  })
})

describe('per-context cache (anti-poisoning)', () => {
  it('a scope warmed under context vA is NOT served to the union view', async () => {
    getVdcContextMock.mockResolvedValueOnce('vA')
    vdcFindManyMock.mockResolvedValueOnce([row('vA', 'conn-A')])
    const narrowed = await getVdcScope('t1')
    expect(narrowed!.connectionIds).toEqual(new Set(['conn-A']))

    // Second call, no context: must MISS the cache and rebuild the union.
    getVdcContextMock.mockResolvedValueOnce(null)
    const union = await getVdcScope('t1')
    expect(union!.connectionIds).toEqual(new Set(['conn-A', 'conn-B']))
    expect(vdcFindManyMock).toHaveBeenCalledTimes(2)
  })

  it('same context twice → second call served from cache (1 query total)', async () => {
    getVdcContextMock.mockResolvedValue('vA')
    vdcFindManyMock.mockResolvedValue([row('vA', 'conn-A')])
    await getVdcScope('t1')
    await getVdcScope('t1')
    expect(vdcFindManyMock).toHaveBeenCalledTimes(1)
  })

  it('clearVdcScopeCache(tenantId) purges the union AND every context entry', async () => {
    getVdcContextMock.mockResolvedValueOnce('vA')
    vdcFindManyMock.mockResolvedValueOnce([row('vA', 'conn-A')])
    await getVdcScope('t1') // warm t1::vA
    getVdcContextMock.mockResolvedValueOnce(null)
    await getVdcScope('t1') // warm t1::all

    clearVdcScopeCache('t1')

    getVdcContextMock.mockResolvedValueOnce('vA')
    vdcFindManyMock.mockResolvedValueOnce([row('vA', 'conn-A')])
    await getVdcScope('t1')
    getVdcContextMock.mockResolvedValueOnce(null)
    await getVdcScope('t1')
    // 2 warmups + 2 rebuilds after the purge = 4 queries
    expect(vdcFindManyMock).toHaveBeenCalledTimes(4)
  })

  it('clearVdcScopeCache(tenantId) leaves other tenants cached', async () => {
    await getVdcScope('t1')
    await getVdcScope('t2')
    clearVdcScopeCache('t1')
    await getVdcScope('t2') // still cached
    expect(vdcFindManyMock).toHaveBeenCalledTimes(2)
  })

  it('a scope warmed under context vA is NOT served to context vB', async () => {
    getVdcContextMock.mockResolvedValueOnce('vA')
    vdcFindManyMock.mockResolvedValueOnce([row('vA', 'conn-A')])
    await getVdcScope('t1')
    getVdcContextMock.mockResolvedValueOnce('vB')
    vdcFindManyMock.mockResolvedValueOnce([row('vB', 'conn-B')])
    const b = await getVdcScope('t1')
    expect(b!.connectionIds).toEqual(new Set(['conn-B']))
    expect(vdcFindManyMock).toHaveBeenCalledTimes(2)
  })

  it('the union is NOT served to a narrowed context', async () => {
    getVdcContextMock.mockResolvedValueOnce(null)
    await getVdcScope('t1')
    getVdcContextMock.mockResolvedValueOnce('vA')
    vdcFindManyMock.mockResolvedValueOnce([row('vA', 'conn-A')])
    const narrowed = await getVdcScope('t1')
    expect(narrowed!.connectionIds).toEqual(new Set(['conn-A']))
  })

  it('prefix purge does not cross tenants sharing a prefix (t1 vs t1x)', async () => {
    await getVdcScope('t1')
    await getVdcScope('t1x')
    clearVdcScopeCache('t1')
    await getVdcScope('t1x')
    expect(vdcFindManyMock).toHaveBeenCalledTimes(2)
  })
})
