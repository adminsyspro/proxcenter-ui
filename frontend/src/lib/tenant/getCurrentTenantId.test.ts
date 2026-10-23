import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPrincipalMock, tenantFindUniqueMock, roleFindFirstMock, membershipFindUniqueMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  roleFindFirstMock: vi.fn(),
  membershipFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: getPrincipalMock }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: { findUnique: tenantFindUniqueMock },
    rbacUserRole: { findFirst: roleFindFirstMock },
    userTenant: { findUnique: membershipFindUniqueMock },
  },
}))

import { getCurrentTenantId, TenantAccessError } from './index'

function session(tenantId: string, userId = 'u1') {
  return {
    ok: true,
    principal: { kind: 'session', tenantId, userId, connectionIds: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  roleFindFirstMock.mockResolvedValue(null)
  membershipFindUniqueMock.mockResolvedValue({ userId: 'u1' })
})

describe('getCurrentTenantId', () => {
  it('returns default when there is no principal without looking up a tenant', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true })

    await expect(getCurrentTenantId()).resolves.toBe('default')
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })

  it('throws TenantAccessError when the session tenant is missing', async () => {
    getPrincipalMock.mockResolvedValue(session('missing'))
    tenantFindUniqueMock.mockResolvedValue(null)

    await expect(getCurrentTenantId()).rejects.toBeInstanceOf(TenantAccessError)
    expect(membershipFindUniqueMock).not.toHaveBeenCalled()
  })

  it('throws TenantAccessError when the session tenant is disabled', async () => {
    getPrincipalMock.mockResolvedValue(session('off'))
    tenantFindUniqueMock.mockResolvedValue({ id: 'off', enabled: false })

    await expect(getCurrentTenantId()).rejects.toBeInstanceOf(TenantAccessError)
  })

  it.each(['tenant-a', 'default'])('throws when a regular user is not a member of %s', async tenantId => {
    getPrincipalMock.mockResolvedValue(session(tenantId))
    tenantFindUniqueMock.mockResolvedValue({ id: tenantId, enabled: true })
    membershipFindUniqueMock.mockResolvedValue(null)

    await expect(getCurrentTenantId()).rejects.toBeInstanceOf(TenantAccessError)
    expect(membershipFindUniqueMock).toHaveBeenCalledWith({
      where: { userId_tenantId: { userId: 'u1', tenantId } },
      select: { userId: true },
    })
  })

  it('allows a super admin even without a membership row', async () => {
    getPrincipalMock.mockResolvedValue(session('tenant-a'))
    tenantFindUniqueMock.mockResolvedValue({ id: 'tenant-a', enabled: true })
    roleFindFirstMock.mockResolvedValue({ id: 'grant-1' })
    membershipFindUniqueMock.mockResolvedValue(null)

    await expect(getCurrentTenantId()).resolves.toBe('tenant-a')
    expect(membershipFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns an active tenant for one of its members', async () => {
    getPrincipalMock.mockResolvedValue(session('tenant-a'))
    tenantFindUniqueMock.mockResolvedValue({ id: 'tenant-a', enabled: true })

    await expect(getCurrentTenantId()).resolves.toBe('tenant-a')
  })

  it('returns a token tenant directly without tenant or membership lookup', async () => {
    getPrincipalMock.mockResolvedValue({
      ok: true,
      principal: { kind: 'token', tenantId: 'tenant-token', tokenId: 'tok-1', connectionIds: null },
    })

    await expect(getCurrentTenantId()).resolves.toBe('tenant-token')
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
    expect(roleFindFirstMock).not.toHaveBeenCalled()
  })

  it('keeps the fail-closed rejection from getPrincipal', async () => {
    getPrincipalMock.mockResolvedValue({ ok: false, rejection: { status: 401, body: {} } })

    await expect(getCurrentTenantId()).rejects.toThrow(/^Invalid or expired API token$/)
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })
})
