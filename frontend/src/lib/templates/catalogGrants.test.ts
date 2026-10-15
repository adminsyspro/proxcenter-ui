import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  vdcFindMany: vi.fn<(...a: any[]) => Promise<any[]>>(),
  blueprintFindMany: vi.fn<(...a: any[]) => Promise<any[]>>(),
  blueprintFindFirst: vi.fn<(...a: any[]) => Promise<any>>(),
  imageFindMany: vi.fn<(...a: any[]) => Promise<any[]>>(),
  tenantFindMany: vi.fn<(...a: any[]) => Promise<any[]>>(),
  grantFindMany: vi.fn<(...a: any[]) => Promise<any[]>>(),
  grantDeleteMany: vi.fn<(...a: any[]) => any>(),
  grantCreateMany: vi.fn<(...a: any[]) => any>(),
  transaction: vi.fn<(...a: any[]) => Promise<any>>(),
  getVdcContext: vi.fn<(...a: any[]) => Promise<string | null>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdc: { findMany: m.vdcFindMany },
    blueprint: { findMany: m.blueprintFindMany, findFirst: m.blueprintFindFirst },
    customImage: { findMany: m.imageFindMany },
    tenant: { findMany: m.tenantFindMany },
    catalogGrant: {
      findMany: m.grantFindMany,
      deleteMany: (args: any) => m.grantDeleteMany(args),
      createMany: (args: any) => m.grantCreateMany(args),
    },
    $transaction: m.transaction,
  },
}))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/vdc/context', () => ({ getVdcContext: m.getVdcContext }))

import {
  blueprintVisibilityWhere,
  customImageVisibilityWhere,
  findBlueprintForTenant,
  granteeVdcIds,
  listVisibleBlueprints,
  loadGrantSummaries,
  normalizeIdList,
  replaceTenantGrants,
  replaceVdcCatalogGrants,
  vdcCatalogGrants,
} from './catalogGrants'

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.vdcFindMany.mockResolvedValue([])
  m.blueprintFindMany.mockResolvedValue([])
  m.blueprintFindFirst.mockResolvedValue(null)
  m.imageFindMany.mockResolvedValue([])
  m.tenantFindMany.mockResolvedValue([])
  m.grantFindMany.mockResolvedValue([])
  m.grantDeleteMany.mockImplementation(args => ({ op: 'delete', args }))
  m.grantCreateMany.mockImplementation(args => ({ op: 'create', args }))
  m.transaction.mockResolvedValue([])
  m.getVdcContext.mockResolvedValue(null)
})

describe('granteeVdcIds', () => {
  it('is empty for the provider, whatever is asked', async () => {
    expect(await granteeVdcIds('default')).toEqual([])
    expect(await granteeVdcIds('default', { vdcId: 'vdc-1' })).toEqual([])
    expect(m.vdcFindMany).not.toHaveBeenCalled()
  })

  it('pins an explicit target vDC without touching the context or the DB', async () => {
    m.getVdcContext.mockResolvedValue('vdc-ctx')
    expect(await granteeVdcIds('t1', { vdcId: 'vdc-target' })).toEqual(['vdc-target'])
    expect(m.getVdcContext).not.toHaveBeenCalled()
    expect(m.vdcFindMany).not.toHaveBeenCalled()
  })

  it('follows the view context, then falls back to the enabled vDCs of the tenant', async () => {
    m.getVdcContext.mockResolvedValue('vdc-ctx')
    expect(await granteeVdcIds('t1')).toEqual(['vdc-ctx'])
    m.getVdcContext.mockResolvedValue(null)
    m.vdcFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    expect(await granteeVdcIds('t1')).toEqual(['a', 'b'])
    expect(m.vdcFindMany).toHaveBeenCalledWith({ where: { tenantId: 't1', enabled: true }, select: { id: true } })
  })

  it('null asks for the union and skips the context', async () => {
    m.getVdcContext.mockResolvedValue('vdc-ctx')
    m.vdcFindMany.mockResolvedValue([{ id: 'a' }])
    expect(await granteeVdcIds('t1', { vdcId: null })).toEqual(['a'])
    expect(m.getVdcContext).not.toHaveBeenCalled()
  })
})

describe('visibility clauses', () => {
  it('keeps the provider on its own rows', () => {
    expect(customImageVisibilityWhere('default', ['v'])).toEqual({ tenantId: 'default' })
    expect(blueprintVisibilityWhere('default', ['v'])).toEqual({ tenantId: 'default' })
  })

  it('unions own, shared and granted provider rows for a tenant', () => {
    expect(blueprintVisibilityWhere('t1', ['v1'])).toEqual({
      OR: [
        { tenantId: 't1' },
        { tenantId: 'default', isShared: true },
        { tenantId: 'default', grants: { some: { OR: [{ granteeTenantId: 't1' }, { vdcId: { in: ['v1'] } }] } } },
      ],
    })
  })

  it('omits the vDC clause when no vDC is in play', () => {
    expect(customImageVisibilityWhere('t1')).toEqual({
      OR: [
        { tenantId: 't1' },
        { tenantId: 'default', isShared: true },
        { tenantId: 'default', grants: { some: { OR: [{ granteeTenantId: 't1' }] } } },
      ],
    })
  })
})

describe('blueprint reads', () => {
  it('lists newest first within the visibility scope', async () => {
    m.vdcFindMany.mockResolvedValue([{ id: 'v1' }])
    await listVisibleBlueprints('t1')
    expect(m.blueprintFindMany).toHaveBeenCalledWith({
      where: blueprintVisibilityWhere('t1', ['v1']),
      orderBy: { createdAt: 'desc' },
    })
  })

  it('resolves one blueprint by id inside the scope of the target vDC', async () => {
    m.blueprintFindFirst.mockResolvedValue({ id: 'bp' })
    expect(await findBlueprintForTenant('t1', 'bp', { vdcId: 'v9' })).toEqual({ id: 'bp' })
    expect(m.blueprintFindFirst).toHaveBeenCalledWith({ where: { AND: [{ id: 'bp' }, blueprintVisibilityWhere('t1', ['v9'])] } })
  })
})

describe('loadGrantSummaries', () => {
  it('returns an empty summary for every id, filled from the grant rows', async () => {
    m.grantFindMany.mockResolvedValue([
      { imageId: 'i1', blueprintId: null, granteeTenantId: 't1', vdcId: null },
      { imageId: 'i1', blueprintId: null, granteeTenantId: null, vdcId: 'v1' },
      { imageId: 'i-other', blueprintId: null, granteeTenantId: 't9', vdcId: null },
    ])
    const out = await loadGrantSummaries('image', ['i1', 'i2'])
    expect(out.get('i1')).toEqual({ tenantIds: ['t1'], vdcIds: ['v1'] })
    expect(out.get('i2')).toEqual({ tenantIds: [], vdcIds: [] })
    expect(out.has('i-other')).toBe(false)
    expect(m.grantFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { imageId: { in: ['i1', 'i2'] } } }))
  })

  it('does not query for an empty id list', async () => {
    expect((await loadGrantSummaries('blueprint', [])).size).toBe(0)
    expect(m.grantFindMany).not.toHaveBeenCalled()
  })
})

describe('replaceTenantGrants', () => {
  it('replaces the per-tenant grants of the entry and leaves the vDC grants alone', async () => {
    m.tenantFindMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    await replaceTenantGrants('image', 'i1', ['t1', 't2', 't1', 'default'], 'user-1')
    const ops = m.transaction.mock.calls[0][0]
    expect(ops[0]).toEqual({ op: 'delete', args: { where: { AND: [{ imageId: 'i1' }, { granteeTenantId: { not: null } }] } } })
    expect(ops[1]).toEqual({
      op: 'create',
      args: { data: [{ imageId: 'i1', granteeTenantId: 't1', createdBy: 'user-1' }, { imageId: 'i1', granteeTenantId: 't2', createdBy: 'user-1' }] },
    })
  })

  it('an empty list purges without creating', async () => {
    await replaceTenantGrants('blueprint', 'b1', [], null)
    const ops = m.transaction.mock.calls[0][0]
    expect(ops).toHaveLength(1)
    expect(ops[0].args.where.AND[0]).toEqual({ blueprintId: 'b1' })
    expect(m.tenantFindMany).not.toHaveBeenCalled()
  })

  it('refuses an unknown tenant instead of dropping it silently', async () => {
    m.tenantFindMany.mockResolvedValue([{ id: 't1' }])
    await expect(replaceTenantGrants('image', 'i1', ['t1', 'ghost'], null)).rejects.toThrow('Unknown tenant: ghost')
    expect(m.transaction).not.toHaveBeenCalled()
  })
})

describe('vDC grants', () => {
  it('reads the entries granted to a vDC', async () => {
    m.grantFindMany.mockResolvedValue([{ imageId: 'i1', blueprintId: null }, { imageId: null, blueprintId: 'b1' }])
    expect(await vdcCatalogGrants('v1')).toEqual({ imageIds: ['i1'], blueprintIds: ['b1'] })
  })

  it('replaces both kinds, after checking the entries are provider-owned', async () => {
    m.imageFindMany.mockResolvedValue([{ id: 'i1' }])
    m.blueprintFindMany.mockResolvedValue([{ id: 'b1' }])
    await replaceVdcCatalogGrants('v1', { imageIds: ['i1', 'i1'], blueprintIds: ['b1'] }, 'admin')
    expect(m.imageFindMany).toHaveBeenCalledWith({ where: { id: { in: ['i1'] }, tenantId: 'default' }, select: { id: true } })
    const ops = m.transaction.mock.calls[0][0]
    expect(ops[0]).toEqual({ op: 'delete', args: { where: { vdcId: 'v1' } } })
    expect(ops[1].args.data).toEqual([{ imageId: 'i1', vdcId: 'v1', createdBy: 'admin' }, { blueprintId: 'b1', vdcId: 'v1', createdBy: 'admin' }])
  })

  it("refuses a tenant's private image: only provider rows can be granted", async () => {
    m.imageFindMany.mockResolvedValue([])
    await expect(replaceVdcCatalogGrants('v1', { imageIds: ['i-tenant'], blueprintIds: [] }, null)).rejects.toThrow(/provider images/)
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('keeps the kind that is left undefined', async () => {
    m.grantFindMany.mockResolvedValue([{ imageId: 'i-keep', blueprintId: null }])
    m.imageFindMany.mockResolvedValue([{ id: 'i-keep' }])
    m.blueprintFindMany.mockResolvedValue([{ id: 'b-new' }])
    await replaceVdcCatalogGrants('v1', { blueprintIds: ['b-new'] }, null)
    const ops = m.transaction.mock.calls[0][0]
    expect(ops[1].args.data).toEqual([{ imageId: 'i-keep', vdcId: 'v1', createdBy: null }, { blueprintId: 'b-new', vdcId: 'v1', createdBy: null }])
  })
})

describe('normalizeIdList', () => {
  it('keeps distinct non-empty strings and rejects anything else', () => {
    expect(normalizeIdList(['a', ' b ', 'a', '', 3, null])).toEqual(['a', 'b'])
    expect(normalizeIdList('a')).toBeUndefined()
    expect(normalizeIdList(undefined)).toBeUndefined()
  })
})
