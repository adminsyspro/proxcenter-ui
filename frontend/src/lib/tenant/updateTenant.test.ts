import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  tenantFindUniqueMock, tenantUpdateMock, userTenantFindManyMock, sessionUpdateManyMock,
  transactionMock, roleDeleteManyMock, tenantDeleteManyMock,
} = vi.hoisted(() => ({
  tenantFindUniqueMock: vi.fn(),
  tenantUpdateMock: vi.fn(),
  userTenantFindManyMock: vi.fn(),
  sessionUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  roleDeleteManyMock: vi.fn(),
  tenantDeleteManyMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUniqueMock,
      update: tenantUpdateMock,
    },
    userTenant: { findMany: userTenantFindManyMock },
    session: { updateMany: sessionUpdateManyMock },
    $transaction: transactionMock,
  },
}))

import { deleteTenant, updateTenant } from './index'

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
  userTenantFindManyMock.mockReset().mockResolvedValue([])
  sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 0 })
  roleDeleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  tenantDeleteManyMock.mockReset().mockResolvedValue({ count: 1 })
  transactionMock.mockReset().mockImplementation(async (callback: any) => callback({
    rbacUserRole: { deleteMany: roleDeleteManyMock },
    tenant: { deleteMany: tenantDeleteManyMock },
  }))
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

  it('revokes live sessions of default members when an active tenant is disabled', async () => {
    userTenantFindManyMock.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])

    await updateTenant('t1', { enabled: false })

    expect(userTenantFindManyMock).toHaveBeenCalledExactlyOnceWith({
      where: { tenantId: 't1', isDefault: true },
      select: { userId: true },
    })
    expect(sessionUpdateManyMock).toHaveBeenCalledExactlyOnceWith({
      where: { userId: { in: ['u1', 'u2'] }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('does not revoke again when the tenant was already disabled', async () => {
    tenantFindUniqueMock.mockResolvedValue({ ...EXISTING, enabled: false })

    await updateTenant('t1', { enabled: false })

    expect(userTenantFindManyMock).not.toHaveBeenCalled()
    expect(sessionUpdateManyMock).not.toHaveBeenCalled()
  })

  it('does not revoke sessions when enabled is not changed', async () => {
    await updateTenant('t1', { name: 'Renamed' })

    expect(userTenantFindManyMock).not.toHaveBeenCalled()
    expect(sessionUpdateManyMock).not.toHaveBeenCalled()
  })

  it('does not issue an empty session update when there are no default members', async () => {
    userTenantFindManyMock.mockResolvedValue([])

    await updateTenant('t1', { enabled: false })

    expect(userTenantFindManyMock).toHaveBeenCalledOnce()
    expect(sessionUpdateManyMock).not.toHaveBeenCalled()
  })
})

describe('deleteTenant', () => {
  it('revokes member sessions before deleting the tenant in a transaction', async () => {
    const order: string[] = []
    userTenantFindManyMock.mockResolvedValue([{ userId: 'u1' }])
    sessionUpdateManyMock.mockImplementation(async () => {
      order.push('revoke')
      return { count: 1 }
    })
    transactionMock.mockImplementation(async (callback: any) => {
      order.push('transaction')
      return callback({
        rbacUserRole: { deleteMany: roleDeleteManyMock },
        tenant: { deleteMany: tenantDeleteManyMock },
      })
    })

    await expect(deleteTenant('t1')).resolves.toBe(true)

    expect(order).toEqual(['revoke', 'transaction'])
    expect(sessionUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: { in: ['u1'] }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(roleDeleteManyMock).toHaveBeenCalledWith({ where: { tenantId: 't1' } })
    expect(tenantDeleteManyMock).toHaveBeenCalledWith({ where: { id: 't1', NOT: { id: 'default' } } })
  })

  it('does nothing for the default tenant', async () => {
    await expect(deleteTenant('default')).resolves.toBe(false)

    expect(userTenantFindManyMock).not.toHaveBeenCalled()
    expect(sessionUpdateManyMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
