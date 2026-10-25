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
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', tenantId: 'default', email: 'u1@example.com' } })
  checkPermissionMock.mockReset().mockResolvedValue(null)
  superAdminMock.mockReset().mockResolvedValue(true)
})

describe('requireTlsAdmin', () => {
  it('allows a super-admin on the default tenant, with no licence involved', async () => {
    const { requireTlsAdmin } = await import('./guard')
    const result = await requireTlsAdmin()

    expect(result.denied).toBeNull()
    expect(result).toMatchObject({ userId: 'u1', userEmail: 'u1@example.com' })
  })

  it('refuses a caller with no session at all', async () => {
    sessionMock.mockResolvedValue(null)
    const { requireTlsAdmin } = await import('./guard')

    expect((await requireTlsAdmin()).denied?.status).toBe(401)
  })

  it.each([
    ['another tenant', 'tenant-b'],
    ['no tenant claim', undefined],
  ])('refuses a super-admin with %s, without any RBAC work', async (_label, tenantId) => {
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId } })
    const { requireTlsAdmin } = await import('./guard')

    expect((await requireTlsAdmin()).denied?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('propagates the permission refusal untouched', async () => {
    const denial = new Response(null, { status: 403 })

    checkPermissionMock.mockResolvedValue(denial)
    const { requireTlsAdmin } = await import('./guard')

    expect((await requireTlsAdmin()).denied).toBe(denial)
  })

  it('refuses a default-tenant admin who is not super-admin', async () => {
    superAdminMock.mockResolvedValue(false)
    const { requireTlsAdmin } = await import('./guard')

    expect((await requireTlsAdmin()).denied?.status).toBe(403)
  })
})
