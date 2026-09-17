import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionMock, checkPermissionMock, superAdminMock, requireFeatureMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  superAdminMock: vi.fn(),
  requireFeatureMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: any[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/license/features', () => ({ Features: { SYSLOG_FORWARDING: 'syslog_forwarding' } }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  isUserSuperAdmin: (...a: any[]) => superAdminMock(...a),
}))

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', tenantId: 'default', email: 'u1@example.com' } })
  checkPermissionMock.mockReset().mockResolvedValue(null)
  superAdminMock.mockReset().mockResolvedValue(true)
  requireFeatureMock.mockReset().mockResolvedValue(null)
})

describe('requireSyslogAdmin', () => {
  it('allows a super-admin on the provider tenant with the feature licensed', async () => {
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied).toBeNull()
    expect(result).toMatchObject({ userId: 'u1', userEmail: 'u1@example.com' })
    expect(requireFeatureMock).toHaveBeenCalledWith('syslog_forwarding')
  })

  it('falls back to a null email when the session carries none', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result).toMatchObject({ userId: 'u1', userEmail: null })
  })

  it('refuses a caller with no session at all', async () => {
    sessionMock.mockResolvedValue(null)
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied?.status).toBe(401)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('refuses a session without a user id', async () => {
    sessionMock.mockResolvedValue({ user: { tenantId: 'default' } })
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied?.status).toBe(401)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('refuses a tenant admin whose raw session tenant is not default, without any RBAC work', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(superAdminMock).not.toHaveBeenCalled()
  })

  it('propagates the permission refusal untouched', async () => {
    const denial = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied).toBe(denial)
  })

  it('refuses a provider-tenant admin who is not super-admin', async () => {
    superAdminMock.mockResolvedValue(false)
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied?.status).toBe(403)
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })

  it('propagates the licence refusal from requireFeature untouched', async () => {
    const denial = new Response(null, { status: 402 })
    requireFeatureMock.mockResolvedValue(denial)
    const { requireSyslogAdmin } = await import('./guard')
    const result = await requireSyslogAdmin()
    expect(result.denied).toBe(denial)
  })
})
