import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn<(...args: any[]) => Promise<any[]>>()
const findFirstMock = vi.fn<(...args: any[]) => Promise<any>>()
const vdcFindManyMock = vi.fn<(...args: any[]) => Promise<any[]>>()
const getVdcContextMock = vi.fn<(...args: any[]) => Promise<string | null>>()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    customImage: { findMany: (...a: any[]) => findManyMock(...a), findFirst: (...a: any[]) => findFirstMock(...a) },
    vdc: { findMany: (...a: any[]) => vdcFindManyMock(...a) },
  },
}))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/vdc/context', () => ({ getVdcContext: (...a: any[]) => getVdcContextMock(...a) }))

const load = () => import('./customImageScope')

const sharedOrGranted = (tenantId: string, vdcIds: string[] = []) => ({
  OR: [
    { tenantId },
    { tenantId: 'default', isShared: true },
    {
      tenantId: 'default',
      grants: { some: { OR: [{ granteeTenantId: tenantId }, ...(vdcIds.length ? [{ vdcId: { in: vdcIds } }] : [])] } },
    },
  ],
})

beforeEach(() => {
  vi.resetModules()
  findManyMock.mockReset().mockResolvedValue([])
  findFirstMock.mockReset().mockResolvedValue(null)
  vdcFindManyMock.mockReset().mockResolvedValue([])
  getVdcContextMock.mockReset().mockResolvedValue(null)
})

describe('customImageScopeWhere', () => {
  it('keeps the provider on its own rows', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('default')).toEqual({ tenantId: 'default' })
    expect(customImageScopeWhere('default', ['vdc-1'])).toEqual({ tenantId: 'default' })
  })

  it('adds the provider shared catalogue and the tenant grants for a tenant', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('tenant-1')).toEqual(sharedOrGranted('tenant-1'))
  })

  it('adds the vDC grants when vDC ids are in play (#903)', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('tenant-1', ['vdc-a', 'vdc-b'])).toEqual(sharedOrGranted('tenant-1', ['vdc-a', 'vdc-b']))
  })

  // The bug this module exists for: the catalogue listed a shared template and
  // the deploy route, scoped to the caller alone, then refused the slug.
  it('never limits a tenant to its own rows', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('tenant-1')).not.toEqual({ tenantId: 'tenant-1' })
  })
})

describe('findCustomImageForTenant', () => {
  it('returns null when the slug is outside the scope', async () => {
    const { findCustomImageForTenant } = await load()
    expect(await findCustomImageForTenant('tenant-1', 'nope')).toBeNull()
  })

  it('finds a shared provider image for a tenant that does not own it, without the grant flag', async () => {
    findManyMock.mockResolvedValue([{ tenantId: 'default', slug: 'custom-fortigate', isShared: true }])
    const { findCustomImageForTenant } = await load()
    const row = await findCustomImageForTenant('tenant-1', 'custom-fortigate')
    expect(row?.tenantId).toBe('default')
    expect(row?.visibleViaGrant).toBe(false)
  })

  it('flags a provider image reached through a grant (#903)', async () => {
    findManyMock.mockResolvedValue([{ tenantId: 'default', slug: 'custom-golden', isShared: false }])
    const { findCustomImageForTenant } = await load()
    const row = await findCustomImageForTenant('tenant-1', 'custom-golden')
    expect(row?.visibleViaGrant).toBe(true)
  })

  it('never flags the provider own rows nor a tenant own row', async () => {
    findManyMock.mockResolvedValue([{ tenantId: 'default', slug: 'custom-golden', isShared: false }])
    const { findCustomImageForTenant } = await load()
    expect((await findCustomImageForTenant('default', 'custom-golden'))?.visibleViaGrant).toBe(false)
    findManyMock.mockResolvedValue([{ tenantId: 'tenant-1', slug: 'custom-mine', isShared: false }])
    expect((await findCustomImageForTenant('tenant-1', 'custom-mine'))?.visibleViaGrant).toBe(false)
  })

  it('prefers the tenant own row over a shared one carrying the same slug', async () => {
    findManyMock.mockResolvedValue([
      { tenantId: 'default', slug: 'custom-dup', isShared: true },
      { tenantId: 'tenant-1', slug: 'custom-dup', isShared: false },
    ])
    const { findCustomImageForTenant } = await load()
    const row = await findCustomImageForTenant('tenant-1', 'custom-dup')
    expect(row?.tenantId).toBe('tenant-1')
  })

  it('queries on the slug within the caller scope, with the tenant union of vDCs by default', async () => {
    vdcFindManyMock.mockResolvedValue([{ id: 'vdc-a' }, { id: 'vdc-b' }])
    const { findCustomImageForTenant } = await load()
    await findCustomImageForTenant('tenant-1', 'custom-fortigate')
    expect(vdcFindManyMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', enabled: true }, select: { id: true } })
    expect(findManyMock).toHaveBeenCalledWith({
      where: { AND: [{ slug: 'custom-fortigate' }, sharedOrGranted('tenant-1', ['vdc-a', 'vdc-b'])] },
    })
  })

  it('pins the grants to the target vDC when the caller names one (deploy verdict)', async () => {
    vdcFindManyMock.mockResolvedValue([{ id: 'vdc-a' }, { id: 'vdc-b' }])
    const { findCustomImageForTenant } = await load()
    await findCustomImageForTenant('tenant-1', 'custom-fortigate', { vdcId: 'vdc-b' })
    expect(vdcFindManyMock).not.toHaveBeenCalled()
    expect(findManyMock).toHaveBeenCalledWith({
      where: { AND: [{ slug: 'custom-fortigate' }, sharedOrGranted('tenant-1', ['vdc-b'])] },
    })
  })

  it('follows the vDC view context when no target is named', async () => {
    getVdcContextMock.mockResolvedValue('vdc-ctx')
    const { findCustomImageForTenant } = await load()
    await findCustomImageForTenant('tenant-1', 'custom-fortigate')
    expect(vdcFindManyMock).not.toHaveBeenCalled()
    expect(findManyMock).toHaveBeenCalledWith({
      where: { AND: [{ slug: 'custom-fortigate' }, sharedOrGranted('tenant-1', ['vdc-ctx'])] },
    })
  })

  it('ignores the view context for an explicit union (null)', async () => {
    getVdcContextMock.mockResolvedValue('vdc-ctx')
    vdcFindManyMock.mockResolvedValue([{ id: 'vdc-a' }])
    const { findCustomImageForTenant } = await load()
    await findCustomImageForTenant('tenant-1', 'custom-fortigate', { vdcId: null })
    expect(getVdcContextMock).not.toHaveBeenCalled()
    expect(findManyMock).toHaveBeenCalledWith({
      where: { AND: [{ slug: 'custom-fortigate' }, sharedOrGranted('tenant-1', ['vdc-a'])] },
    })
  })
})

describe('isProviderImageSlug', () => {
  it('tells a hidden provider slug from an unknown one', async () => {
    const { isProviderImageSlug } = await load()
    expect(await isProviderImageSlug('nope')).toBe(false)
    findFirstMock.mockResolvedValue({ id: 'img-1' })
    expect(await isProviderImageSlug('custom-golden')).toBe(true)
    expect(findFirstMock).toHaveBeenCalledWith({ where: { slug: 'custom-golden', tenantId: 'default' }, select: { id: true } })
  })
})
