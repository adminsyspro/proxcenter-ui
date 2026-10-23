import { describe, it, expect, vi, afterEach } from 'vitest'

const { userFindUniqueMock, userTenantFindManyMock, policyFindFirstMock, roleFindFirstMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userTenantFindManyMock: vi.fn(),
  policyFindFirstMock: vi.fn(),
  roleFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    userTenant: { findMany: userTenantFindManyMock },
    securityPolicy: { findFirst: policyFindFirstMock },
    rbacUserRole: { findFirst: roleFindFirstMock },
  },
}))

import { isSessionTenantDisabled, loadJwtContext } from './jwtContext'
import { sessionRowSelect } from './sessions'

afterEach(() => vi.clearAllMocks())

const sessionRow = {
  id: 'sid1', userId: 'u1',
  createdAt: new Date('2026-08-03T11:00:00Z'),
  lastSeenAt: new Date('2026-08-03T11:59:00Z'),
  revokedAt: null, ipAddress: null, userAgent: null,
}

describe('loadJwtContext', () => {
  it('keeps the multi-KB idToken off the per-request session read', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [], sessions: [sessionRow],
    })

    await loadJwtContext('u1', 'sid1')

    const sessions = userFindUniqueMock.mock.calls[0][0].select.sessions
    expect(sessions).toEqual({ where: { id: 'sid1' }, take: 1, select: sessionRowSelect })
    expect(sessions.select).not.toHaveProperty('idToken')
  })

  it('reads enabled, tenant, 2FA and the session row in ONE query for an enrolled user', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [{ tenantId: 'tenant-a', tenant: { enabled: true } }],
      sessions: [sessionRow],
    })

    const ctx = await loadJwtContext('u1', 'sid1')

    expect(ctx).toEqual({
      enabled: true, tenantId: 'tenant-a', tenantEnabled: true, mustEnroll2fa: false, session: sessionRow,
    })
    expect(userFindUniqueMock).toHaveBeenCalledOnce()
    // An enrolled user needs no policy lookup at all.
    expect(policyFindFirstMock).not.toHaveBeenCalled()
    expect(roleFindFirstMock).not.toHaveBeenCalled()
    // Read every membership in deterministic preference order: a disabled
    // default must not hide another active tenant.
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          tenants: {
            orderBy: [{ isDefault: 'desc' }, { joinedAt: 'asc' }],
            select: { tenantId: true, tenant: { select: { enabled: true } } },
          },
        }),
      }),
    )
    const tenantQuery = userFindUniqueMock.mock.calls[0][0].select.tenants
    expect(tenantQuery).not.toHaveProperty('where')
    expect(tenantQuery).not.toHaveProperty('take')
  })

  it('honours the per-user 2FA flag without consulting the policy', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: false, require2faEnrollment: true,
      tenants: [], sessions: [],
    })
    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx.mustEnroll2fa).toBe(true)
    expect(policyFindFirstMock).not.toHaveBeenCalled()
  })

  it('falls back to the super_admin policy path when neither shortcut applies', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: false, require2faEnrollment: false,
      tenants: [], sessions: [],
    })
    policyFindFirstMock.mockResolvedValue({ require2faForSuperAdmin: true })
    roleFindFirstMock.mockResolvedValue({ id: 'assign1' })

    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx.mustEnroll2fa).toBe(true)
    expect(roleFindFirstMock).toHaveBeenCalledOnce()
    // roleId and the "unexpired" OR clause are the whole security boundary here —
    // a wrong roleId or a dropped expiresAt branch must fail this test.
    expect(roleFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        roleId: 'role_super_admin',
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      select: { id: true },
    })
  })

  it('does not require 2FA when the policy is off', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: false, require2faEnrollment: false,
      tenants: [], sessions: [],
    })
    policyFindFirstMock.mockResolvedValue({ require2faForSuperAdmin: false })

    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx.mustEnroll2fa).toBe(false)
    expect(roleFindFirstMock).not.toHaveBeenCalled()
  })

  it('uses the active default membership first', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [
        { tenantId: 'tenant-default', tenant: { enabled: true } },
        { tenantId: 'tenant-other', tenant: { enabled: true } },
      ],
      sessions: [],
    })
    await expect(loadJwtContext('u1', 'sid1')).resolves.toMatchObject({
      tenantId: 'tenant-default', tenantEnabled: true,
    })
  })

  it('skips a disabled default membership in favour of another active tenant', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [
        { tenantId: 'tenant-disabled', tenant: { enabled: false } },
        { tenantId: 'tenant-active', tenant: { enabled: true } },
      ],
      sessions: [],
    })
    await expect(loadJwtContext('u1', 'sid1')).resolves.toMatchObject({
      tenantId: 'tenant-active', tenantEnabled: true,
    })
  })

  it('keeps the first tenant id but marks the context disabled when every membership is disabled', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [
        { tenantId: 'tenant-first', tenant: { enabled: false } },
        { tenantId: 'tenant-second', tenant: { enabled: false } },
      ],
      sessions: [],
    })
    await expect(loadJwtContext('u1', 'sid1')).resolves.toMatchObject({
      tenantId: 'tenant-first', tenantEnabled: false,
    })
  })

  it('defaults to an enabled "default" tenant when the user has no membership', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [], sessions: [],
    })
    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx.tenantId).toBe('default')
    expect(ctx.tenantEnabled).toBe(true)
  })

  it('reports a deleted user as disabled with a null session', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx).toEqual({
      enabled: false, tenantId: 'default', tenantEnabled: true, mustEnroll2fa: false, session: null,
    })
  })

  it('skips the session sub-select entirely when the token carries no sid', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [{ tenantId: 'default', tenant: { enabled: true } }], sessions: [],
    })
    const ctx = await loadJwtContext('u1', null)
    expect(ctx.session).toBeNull()
    expect(userFindUniqueMock.mock.calls[0][0].select.sessions).toBeUndefined()
  })
})

describe('isSessionTenantDisabled', () => {
  it('returns false without memberships and uses the shared membership query', async () => {
    userTenantFindManyMock.mockResolvedValue([])

    await expect(isSessionTenantDisabled('u1')).resolves.toBe(false)
    expect(userTenantFindManyMock).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ isDefault: 'desc' }, { joinedAt: 'asc' }],
      select: { tenantId: true, tenant: { select: { enabled: true } } },
    })
  })

  it('returns false when at least one membership is active', async () => {
    userTenantFindManyMock.mockResolvedValue([
      { tenantId: 'off', tenant: { enabled: false } },
      { tenantId: 'on', tenant: { enabled: true } },
    ])
    await expect(isSessionTenantDisabled('u1')).resolves.toBe(false)
  })

  it('returns true when every membership is disabled', async () => {
    userTenantFindManyMock.mockResolvedValue([
      { tenantId: 'off-1', tenant: { enabled: false } },
      { tenantId: 'off-2', tenant: { enabled: false } },
    ])
    await expect(isSessionTenantDisabled('u1')).resolves.toBe(true)
  })
})
