import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionMock, checkPermissionMock, superAdminMock, requireFeatureMock, getPrincipalMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  superAdminMock: vi.fn(),
  requireFeatureMock: vi.fn(),
  getPrincipalMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: any[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/auth/principal', () => ({
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
  rejectionToResponse: () => new Response(JSON.stringify({ error: 'rejected' }), { status: 401 }),
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings', BACKUP_RESTORE: 'backup.restore' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  isUserSuperAdmin: (...a: any[]) => superAdminMock(...a),
}))

import { authorizeRestoreTarget, isProviderCaller, requireGuestFileRestoreAdmin, requireGuestFileRestoreUser } from './guard'

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', tenantId: 'default', email: 'u1@example.com' } })
  checkPermissionMock.mockReset().mockResolvedValue(null)
  superAdminMock.mockReset().mockResolvedValue(true)
  requireFeatureMock.mockReset().mockResolvedValue(null)
  getPrincipalMock.mockReset().mockResolvedValue({ ok: true, principal: { kind: 'session', userId: 'u1', userEmail: 'u1@example.com', tenantId: 'default' } })
})

describe('requireGuestFileRestoreAdmin', () => {
  // Community feature: the guards never ask the orchestrator for a licence.
  it('allows a super-admin on the provider tenant, without any licence check', async () => {
    const result = await requireGuestFileRestoreAdmin()
    expect(result.denied).toBeNull()
    expect(result).toMatchObject({ userId: 'u1', userEmail: 'u1@example.com' })
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })
  it('refuses a caller with no session', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await requireGuestFileRestoreAdmin()).denied?.status).toBe(401)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
  it('refuses a tenant admin without any RBAC work', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    expect((await requireGuestFileRestoreAdmin()).denied?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
  it('propagates the permission refusal and refuses non super-admins', async () => {
    const denial = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    expect((await requireGuestFileRestoreAdmin()).denied).toBe(denial)
    checkPermissionMock.mockResolvedValue(null)
    superAdminMock.mockResolvedValue(false)
    expect((await requireGuestFileRestoreAdmin()).denied?.status).toBe(403)
  })
})

describe('requireGuestFileRestoreUser', () => {
  it('returns the principal when authenticated, without any licence check', async () => {
    const result = await requireGuestFileRestoreUser()
    expect(result.denied).toBeNull()
    expect(result.principal).toMatchObject({ userId: 'u1' })
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })
  it('refuses a rejected or missing principal', async () => {
    getPrincipalMock.mockResolvedValue({ ok: false, rejection: { status: 401 } })
    expect((await requireGuestFileRestoreUser()).denied?.status).toBe(401)
    getPrincipalMock.mockResolvedValue({ ok: true, principal: null })
    expect((await requireGuestFileRestoreUser()).denied?.status).toBe(401)
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })
})

describe('authorizeRestoreTarget', () => {
  it('checks BACKUP_RESTORE on the vm resource', async () => {
    await authorizeRestoreTarget({ connId: 'c1', node: 'pve1', type: 'qemu', vmid: 100 })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.restore', 'vm', 'c1:pve1:qemu:100')
  })
})

describe('isProviderCaller', () => {
  it('requires a provider super admin, from the raw session claim, never an API token', async () => {
    expect(await isProviderCaller({ kind: 'session', userId: 'u1', tenantId: 'default' } as any)).toBe(true)
    superAdminMock.mockResolvedValue(false)
    expect(await isProviderCaller({ kind: 'session', userId: 'u1', tenantId: 'default' } as any)).toBe(false)
    superAdminMock.mockResolvedValue(true)
    sessionMock.mockResolvedValue({ user: { id: 'u2', tenantId: 'tenant-b' } })
    expect(await isProviderCaller({ kind: 'session', userId: 'u2', tenantId: 'default' } as any)).toBe(false)
    sessionMock.mockResolvedValue({ user: { id: 'u3' } })
    expect(await isProviderCaller({ kind: 'session', userId: 'u3', tenantId: 'default' } as any)).toBe(false)
    expect(await isProviderCaller({ kind: 'token', tenantId: 'default' } as any)).toBe(false)
  })
})
