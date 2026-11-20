import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueMock = vi.fn<(...a: any[]) => Promise<any>>()

vi.mock('@/lib/db/prisma', () => ({ prisma: { tenant: { findUnique: (...a: any[]) => findUniqueMock(...a) } } }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

import { isBuiltInCatalogHidden } from './builtInCatalogAccess'

beforeEach(() => {
  findUniqueMock.mockReset()
})

describe('isBuiltInCatalogHidden', () => {
  it('never hides the catalogue from the provider, without a lookup', async () => {
    expect(await isBuiltInCatalogHidden('default')).toBe(false)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('hides it from a tenant the provider turned it off for', async () => {
    findUniqueMock.mockResolvedValue({ builtInCatalog: false })
    expect(await isBuiltInCatalogHidden('tenant-1')).toBe(true)
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, select: { builtInCatalog: true } })
  })

  it('keeps it for a tenant where it is on', async () => {
    findUniqueMock.mockResolvedValue({ builtInCatalog: true })
    expect(await isBuiltInCatalogHidden('tenant-1')).toBe(false)
  })

  it('keeps it when the tenant row is gone (the other guards refuse the request)', async () => {
    findUniqueMock.mockResolvedValue(null)
    expect(await isBuiltInCatalogHidden('ghost')).toBe(false)
  })
})
