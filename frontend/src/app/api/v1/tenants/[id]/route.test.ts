import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const {
  updateTenantMock,
  requireProviderTenantMock,
  checkPermissionMock,
  tenantFindUniqueMock,
  findVmidRangeConflictMock,
} = vi.hoisted(() => ({
  updateTenantMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  findVmidRangeConflictMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  updateTenant: (...a: any[]) => updateTenantMock(...a),
  deleteTenant: vi.fn(),
  DEFAULT_TENANT_ID: 'default',
  requireProviderTenant: () => requireProviderTenantMock(),
}))
vi.mock('@/lib/tenant/vmidRange', async (io) => {
  const actual = await io<typeof import('@/lib/tenant/vmidRange')>()
  return { ...actual, findVmidRangeConflict: (...a: any[]) => findVmidRangeConflictMock(...a) }
})
vi.mock('@/lib/db/prisma', () => ({
  prisma: { tenant: { findUnique: (...a: any[]) => tenantFindUniqueMock(...a) } },
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: { ADMIN_TENANTS: 'admin.tenants' },
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1', email: 'u@x' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

beforeEach(() => {
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  updateTenantMock.mockReset().mockResolvedValue({ id: 't1', name: 'Acme' })
  tenantFindUniqueMock.mockReset().mockResolvedValue({ operatingModel: 'msp' })
  findVmidRangeConflictMock.mockReset().mockResolvedValue(null)
})

describe('PUT /api/v1/tenants/[id] vmidRange', () => {
  it('accepts a valid range on an MSP tenant', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 't1' },
      body: { vmidRangeStart: 100, vmidRangeEnd: 200 },
    })
    expect(res.status).toBe(200)
    expect(updateTenantMock).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ vmidRangeStart: 100, vmidRangeEnd: 200 }),
    )
  })

  it('clears the range without an MSP/overlap check', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 't1' },
      body: { vmidRangeStart: null, vmidRangeEnd: null },
    })
    expect(res.status).toBe(200)
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
    expect(findVmidRangeConflictMock).not.toHaveBeenCalled()
    expect(updateTenantMock).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ vmidRangeStart: null, vmidRangeEnd: null }),
    )
  })

  it('rejects a range on a non-MSP tenant with 400', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'iaas' })
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 't1' },
      body: { vmidRangeStart: 100, vmidRangeEnd: 200 },
    })
    expect(res.status).toBe(400)
    expect(updateTenantMock).not.toHaveBeenCalled()
  })

  it('rejects an overlapping range with 409', async () => {
    findVmidRangeConflictMock.mockResolvedValue({ id: 't2', name: 'Globex' })
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 't1' },
      body: { vmidRangeStart: 100, vmidRangeEnd: 200 },
    })
    expect(res.status).toBe(409)
    expect(updateTenantMock).not.toHaveBeenCalled()
  })

  it('rejects a one-sided range with 400', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 't1' },
      body: { vmidRangeStart: 100 },
    })
    expect(res.status).toBe(400)
    expect(updateTenantMock).not.toHaveBeenCalled()
  })
})
