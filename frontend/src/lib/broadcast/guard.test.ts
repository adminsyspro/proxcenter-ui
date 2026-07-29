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

describe('requireBroadcastAdmin', () => {
  it('allows a super-admin on the provider tenant', async () => {
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied).toBeNull()
    expect(result).toMatchObject({ userId: 'u1' })
  })

  it('propagates the permission refusal untouched', async () => {
    const denial = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied).toBe(denial)
  })

  it('refuses a tenant admin whose raw session tenant is not default, without any RBAC work', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('refuses a session with no tenant rather than defaulting to provider, without any RBAC work', async () => {
    // This is the fail-open scenario requireProviderTenant() would let through:
    // getCurrentTenantId() answers "default" for a disabled or non-member
    // tenant, so the guard must never derive the tenant from that helper.
    sessionMock.mockResolvedValue({ user: { id: 'u3' } })
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('never reaches the transitive super-admin lookup inside checkPermission for a wrong-tenant caller', async () => {
    // Regression test for the real checkPermission() -> hasPermission() ->
    // loadUserGrants() -> isUserSuperAdmin() chain (src/lib/rbac/index.ts:
    // 102,264,551). Mimic that internal call here so a future reorder that
    // put checkPermission() ahead of the tenant gate would fail this test.
    checkPermissionMock.mockImplementation(async () => {
      await superAdminMock()
      return null
    })
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied?.status).toBe(403)
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('refuses a provider-tenant admin who is not super-admin', async () => {
    superAdminMock.mockResolvedValue(false)
    const { requireBroadcastAdmin } = await import('./guard')
    expect((await requireBroadcastAdmin()).denied?.status).toBe(403)
  })

  it('refuses an unauthenticated caller without calling checkPermission', async () => {
    sessionMock.mockResolvedValue(null)
    const { requireBroadcastAdmin } = await import('./guard')
    const result = await requireBroadcastAdmin()
    expect(result.denied?.status).toBe(401)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
