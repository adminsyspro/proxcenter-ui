import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tenantFindUniqueMock, tenantUpdateMock } = vi.hoisted(() => ({
  tenantFindUniqueMock: vi.fn(),
  tenantUpdateMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUniqueMock,
      update: tenantUpdateMock,
    },
  },
}))

import { updateTenant } from './index'

const EXISTING = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  description: 'desc',
  enabled: true,
  operatingModel: 'msp',
  vmidRangeStart: 100,
  vmidRangeEnd: 200,
  settings: null,
  createdBy: 'u1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  tenantFindUniqueMock.mockReset().mockResolvedValue({ ...EXISTING })
  // Echo back the merged data so rowToTenant() can map it.
  tenantUpdateMock.mockReset().mockImplementation(async ({ data }: any) => ({ ...EXISTING, ...data }))
})

describe('updateTenant', () => {
  it('returns null when the tenant does not exist', async () => {
    tenantFindUniqueMock.mockResolvedValue(null)
    const result = await updateTenant('missing', { name: 'New name' })
    expect(result).toBeNull()
    expect(tenantUpdateMock).not.toHaveBeenCalled()
  })

  it('sets both vmidRangeStart and vmidRangeEnd when both are provided', async () => {
    const result = await updateTenant('t1', { vmidRangeStart: 300, vmidRangeEnd: 400 })
    expect(tenantUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ vmidRangeStart: 300, vmidRangeEnd: 400 }),
      }),
    )
    expect(result?.vmidRangeStart).toBe(300)
    expect(result?.vmidRangeEnd).toBe(400)
  })

  it('clears the range by writing null when both bounds are explicitly null', async () => {
    const result = await updateTenant('t1', { vmidRangeStart: null, vmidRangeEnd: null })
    expect(tenantUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vmidRangeStart: null, vmidRangeEnd: null }),
      }),
    )
    expect(result?.vmidRangeStart).toBeNull()
    expect(result?.vmidRangeEnd).toBeNull()
  })

  it('preserves the existing range when the fields are absent from the update', async () => {
    await updateTenant('t1', { name: 'Acme Renamed' })
    expect(tenantUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Acme Renamed',
          vmidRangeStart: EXISTING.vmidRangeStart,
          vmidRangeEnd: EXISTING.vmidRangeEnd,
        }),
      }),
    )
  })

  it('merges name/slug/description/enabled, falling back to the existing row when omitted', async () => {
    await updateTenant('t1', { enabled: false })
    expect(tenantUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: EXISTING.name,
          slug: EXISTING.slug,
          description: EXISTING.description,
          enabled: false,
        }),
      }),
    )
  })
})
