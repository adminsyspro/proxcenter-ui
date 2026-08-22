import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../__tests__/setup/route-test'

const { createTenantMock, requireProviderTenantMock, checkPermissionMock, findVmidRangeConflictMock } = vi.hoisted(() => ({
  createTenantMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  findVmidRangeConflictMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  createTenant: (...a: any[]) => createTenantMock(...a),
  listTenants: vi.fn(),
  requireProviderTenant: () => requireProviderTenantMock(),
}))
vi.mock('@/lib/tenant/vmidRange', async (io) => {
  const actual = await io<typeof import('@/lib/tenant/vmidRange')>()
  return { ...actual, findVmidRangeConflict: (...a: any[]) => findVmidRangeConflictMock(...a) }
})
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
  createTenantMock.mockReset().mockResolvedValue({ id: 't1', name: 'Acme' })
  findVmidRangeConflictMock.mockReset().mockResolvedValue(null)
})

describe('POST /api/v1/tenants operatingModel', () => {
  it('forwards a valid operatingModel to createTenant', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'msp' } })
    expect(res.status).toBe(201)
    expect(createTenantMock).toHaveBeenCalledWith(expect.objectContaining({ operatingModel: 'msp' }))
  })

  it('rejects an invalid operatingModel with 400', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'nope' } })
    expect(res.status).toBe(400)
    expect(createTenantMock).not.toHaveBeenCalled()
  })

  it('omitting operatingModel still succeeds (createTenant applies the default)', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme' } })
    expect(res.status).toBe(201)
    expect(createTenantMock).toHaveBeenCalledWith(expect.objectContaining({ operatingModel: undefined }))
  })
})

describe('POST /api/v1/tenants vmidRange', () => {
  it('forwards a valid MSP range to createTenant', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'msp', vmidRangeStart: 189334001, vmidRangeEnd: 189334999 } })
    expect(res.status).toBe(201)
    expect(createTenantMock).toHaveBeenCalledWith(expect.objectContaining({ vmidRangeStart: 189334001, vmidRangeEnd: 189334999 }))
  })
  it('forwards a valid iaas (vDC) range to createTenant', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'iaas', vmidRangeStart: 100, vmidRangeEnd: 200 } })
    expect(res.status).toBe(201)
    expect(createTenantMock).toHaveBeenCalledWith(expect.objectContaining({ operatingModel: 'iaas', vmidRangeStart: 100, vmidRangeEnd: 200 }))
  })
  it.each([
    [{ vmidRangeStart: 300, vmidRangeEnd: 200 }],
    [{ vmidRangeStart: 100 }],
    [{ vmidRangeStart: 99, vmidRangeEnd: 200 }],
    [{ vmidRangeStart: 100, vmidRangeEnd: 1000000000 }],
  ])('rejects invalid range %j with 400', async (range) => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'msp', ...range } })
    expect(res.status).toBe(400)
  })
  it('rejects an overlapping range with 409', async () => {
    findVmidRangeConflictMock.mockResolvedValue({ id: 't2', name: 'Globex' })
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { slug: 'acme', name: 'Acme', operatingModel: 'msp', vmidRangeStart: 100, vmidRangeEnd: 200 } })
    expect(res.status).toBe(409)
  })
})
