import { describe, it, expect, vi, afterEach } from 'vitest'

const { userFindUniqueMock, policyFindFirstMock, roleFindFirstMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  policyFindFirstMock: vi.fn(),
  roleFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    securityPolicy: { findFirst: policyFindFirstMock },
    rbacUserRole: { findFirst: roleFindFirstMock },
  },
}))

import { loadJwtContext } from './jwtContext'

afterEach(() => vi.clearAllMocks())

const sessionRow = {
  id: 'sid1', userId: 'u1',
  createdAt: new Date('2026-08-03T11:00:00Z'),
  lastSeenAt: new Date('2026-08-03T11:59:00Z'),
  revokedAt: null, ipAddress: null, userAgent: null,
}

describe('loadJwtContext', () => {
  it('reads enabled, tenant, 2FA and the session row in ONE query for an enrolled user', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [{ tenantId: 'tenant-a' }],
      sessions: [sessionRow],
    })

    const ctx = await loadJwtContext('u1', 'sid1')

    expect(ctx).toEqual({
      enabled: true, tenantId: 'tenant-a', mustEnroll2fa: false, session: sessionRow,
    })
    expect(userFindUniqueMock).toHaveBeenCalledOnce()
    // An enrolled user needs no policy lookup at all.
    expect(policyFindFirstMock).not.toHaveBeenCalled()
    expect(roleFindFirstMock).not.toHaveBeenCalled()
    // The nested tenant lookup must reproduce getUserDefaultTenantId's predicate exactly.
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          tenants: { where: { isDefault: true }, select: { tenantId: true }, take: 1 },
        }),
      }),
    )
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

  it('defaults the tenant to "default" when the user has no default membership', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [], sessions: [],
    })
    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx.tenantId).toBe('default')
  })

  it('reports a deleted user as disabled with a null session', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    const ctx = await loadJwtContext('u1', 'sid1')
    expect(ctx).toEqual({ enabled: false, tenantId: 'default', mustEnroll2fa: false, session: null })
  })

  it('skips the session sub-select entirely when the token carries no sid', async () => {
    userFindUniqueMock.mockResolvedValue({
      enabled: true, totpEnabled: true, require2faEnrollment: false,
      tenants: [{ tenantId: 'default' }], sessions: [],
    })
    const ctx = await loadJwtContext('u1', null)
    expect(ctx.session).toBeNull()
    expect(userFindUniqueMock.mock.calls[0][0].select.sessions).toBeUndefined()
  })
})
