import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../__tests__/setup/route-test'

const { createTenantMock, requireProviderTenantMock, checkPermissionMock } = vi.hoisted(() => ({
  createTenantMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  createTenant: (...a: any[]) => createTenantMock(...a),
  listTenants: vi.fn(),
  requireProviderTenant: () => requireProviderTenantMock(),
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
  createTenantMock.mockReset().mockResolvedValue({ id: 't1', name: 'Acme' })
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
