import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn<(...args: any[]) => Promise<any[]>>()

vi.mock('@/lib/db/prisma', () => ({ prisma: { customImage: { findMany: (...a: any[]) => findManyMock(...a) } } }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

const load = () => import('./customImageScope')

beforeEach(() => {
  vi.resetModules()
  findManyMock.mockReset().mockResolvedValue([])
})

describe('customImageScopeWhere', () => {
  it('keeps the provider on its own rows', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('default')).toEqual({ tenantId: 'default' })
  })

  it('adds the provider shared catalogue for a tenant', async () => {
    const { customImageScopeWhere } = await load()
    expect(customImageScopeWhere('tenant-1')).toEqual({
      OR: [
        { tenantId: 'tenant-1' },
        { tenantId: 'default', isShared: true },
      ],
    })
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

  it('finds a shared provider image for a tenant that does not own it', async () => {
    findManyMock.mockResolvedValue([{ tenantId: 'default', slug: 'custom-fortigate', isShared: true }])
    const { findCustomImageForTenant } = await load()
    const row = await findCustomImageForTenant('tenant-1', 'custom-fortigate')
    expect(row?.tenantId).toBe('default')
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

  it('queries on the slug within the caller scope', async () => {
    const { findCustomImageForTenant } = await load()
    await findCustomImageForTenant('tenant-1', 'custom-fortigate')
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          { slug: 'custom-fortigate' },
          { OR: [{ tenantId: 'tenant-1' }, { tenantId: 'default', isShared: true }] },
        ],
      },
    })
  })
})
