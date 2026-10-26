import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { rbacUserRole: { findFirst: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { holdsProtectedRole, isEmailVerified, oidcLinkRefusal } from './oidcLinking'

describe('isEmailVerified', () => {
  it('accepts the boolean and the string form only', () => {
    expect(isEmailVerified(true)).toBe(true)
    expect(isEmailVerified('true')).toBe(true)
    expect(isEmailVerified(false)).toBe(false)
    expect(isEmailVerified('false')).toBe(false)
    expect(isEmailVerified(undefined)).toBe(false)
    expect(isEmailVerified(1)).toBe(false)
  })
})

describe('oidcLinkRefusal', () => {
  it('refuses an account already bound to another subject, verified or not', async () => {
    const isProtectedAccount = vi.fn()
    expect(await oidcLinkRefusal({ storedSub: 'other', emailVerified: true, isProtectedAccount })).toBe('oidc_sub_mismatch')
    expect(isProtectedAccount).not.toHaveBeenCalled()
  })

  it('refuses an unverified address for a protected account', async () => {
    const r = await oidcLinkRefusal({ storedSub: null, emailVerified: undefined, isProtectedAccount: async () => true })
    expect(r).toBe('email_not_verified')
  })

  it('links an unverified address to an ordinary account, as before', async () => {
    const r = await oidcLinkRefusal({ storedSub: null, emailVerified: false, isProtectedAccount: async () => false })
    expect(r).toBeNull()
  })

  it('links a verified address without looking up the roles', async () => {
    const isProtectedAccount = vi.fn()
    expect(await oidcLinkRefusal({ storedSub: null, emailVerified: 'true', isProtectedAccount })).toBeNull()
    expect(isProtectedAccount).not.toHaveBeenCalled()
  })
})

describe('holdsProtectedRole', () => {
  beforeEach(() => {
    vi.mocked(prisma.rbacUserRole.findFirst).mockReset()
  })

  it('looks for an active super admin or provider admin grant', async () => {
    const now = new Date('2026-10-26T12:00:00Z')
    vi.mocked(prisma.rbacUserRole.findFirst).mockResolvedValue({ id: 'g1' } as any)

    expect(await holdsProtectedRole('u1', now)).toBe(true)
    expect(prisma.rbacUserRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        roleId: { in: ['role_super_admin', 'role_provider_admin'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    })
  })

  it('is false without such a grant', async () => {
    vi.mocked(prisma.rbacUserRole.findFirst).mockResolvedValue(null)
    expect(await holdsProtectedRole('u1')).toBe(false)
  })
})
