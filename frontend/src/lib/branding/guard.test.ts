import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionMock, checkPermissionMock, superAdminMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  superAdminMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  isUserSuperAdmin: (...a: any[]) => superAdminMock(...a),
}))

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
  checkPermissionMock.mockReset().mockResolvedValue(null)
  superAdminMock.mockReset().mockResolvedValue(true)
})

describe('requireBrandingAdmin', () => {
  it('allows a super admin on the provider tenant', async () => {
    const { requireBrandingAdmin } = await import('./guard')

    expect(await requireBrandingAdmin()).toBeNull()
  })

  it('allows a super admin standing in another tenant, which is how a tenant gets branded', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'tenant-b' } })
    const { requireBrandingAdmin } = await import('./guard')

    expect(await requireBrandingAdmin()).toBeNull()
  })

  it('refuses a tenant admin, whose role carries admin.settings but who may not rebrand', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    superAdminMock.mockResolvedValue(false)
    const { requireBrandingAdmin } = await import('./guard')

    expect((await requireBrandingAdmin())?.status).toBe(403)
  })

  it('propagates the permission refusal untouched', async () => {
    const denial = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    const { requireBrandingAdmin } = await import('./guard')

    expect(await requireBrandingAdmin()).toBe(denial)
  })

  it('refuses an unauthenticated caller without any RBAC work', async () => {
    sessionMock.mockResolvedValue(null)
    const { requireBrandingAdmin } = await import('./guard')

    expect((await requireBrandingAdmin())?.status).toBe(401)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('refuses an API token, which resolves no session user', async () => {
    sessionMock.mockResolvedValue({ user: { tenantId: 'tenant-b' } })
    const { requireBrandingAdmin } = await import('./guard')

    expect((await requireBrandingAdmin())?.status).toBe(401)
  })
})
