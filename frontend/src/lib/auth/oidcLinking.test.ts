import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { rbacUserRole: { findFirst: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { holdsProtectedRole, isEmailVerified, isEmailVouched, oidcLinkRefusal } from './oidcLinking'

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

describe('isEmailVouched', () => {
  it('trusts a verified claim whatever the setting', () => {
    expect(isEmailVouched(true, false)).toBe(true)
    expect(isEmailVouched('true', true)).toBe(true)
  })

  it('reads a missing claim as verified only when the IdP is declared to verify addresses', () => {
    expect(isEmailVouched(undefined, true)).toBe(true)
    expect(isEmailVouched(null, true)).toBe(true)
    expect(isEmailVouched(undefined, false)).toBe(false)
  })

  it('never trusts an explicit false', () => {
    expect(isEmailVouched(false, true)).toBe(false)
    expect(isEmailVouched('false', true)).toBe(false)
  })
})

describe('oidcLinkRefusal', () => {
  const strict = { requireVerifiedEmail: true, idpVerifiesEmail: false }
  const warn = { requireVerifiedEmail: false, idpVerifiesEmail: false }

  it('refuses an account already bound to another subject, verified or not', async () => {
    const isProtectedAccount = vi.fn()
    expect(await oidcLinkRefusal({ ...warn, storedSub: 'other', emailVerified: true, isProtectedAccount })).toBe('oidc_sub_mismatch')
    expect(isProtectedAccount).not.toHaveBeenCalled()
  })

  it('refuses an unverified address for any account when a verified e-mail is required', async () => {
    const isProtectedAccount = vi.fn(async () => false)
    expect(await oidcLinkRefusal({ ...strict, storedSub: null, emailVerified: false, isProtectedAccount })).toBe('email_not_verified')
    expect(await oidcLinkRefusal({ ...strict, storedSub: null, emailVerified: undefined, isProtectedAccount })).toBe('email_not_verified')
  })

  it('refuses an unverified address for a protected account even when the link is only audited', async () => {
    const r = await oidcLinkRefusal({ ...warn, storedSub: null, emailVerified: undefined, isProtectedAccount: async () => true })
    expect(r).toBe('email_not_verified')
  })

  it('links an unverified address to an ordinary account when the link is only audited', async () => {
    const r = await oidcLinkRefusal({ ...warn, storedSub: null, emailVerified: false, isProtectedAccount: async () => false })
    expect(r).toBeNull()
  })

  it('links a verified address without looking up the roles', async () => {
    const isProtectedAccount = vi.fn()
    expect(await oidcLinkRefusal({ ...strict, storedSub: null, emailVerified: 'true', isProtectedAccount })).toBeNull()
    expect(isProtectedAccount).not.toHaveBeenCalled()
  })

  it('links a protected account through an IdP declared to verify addresses that sends no claim', async () => {
    const isProtectedAccount = vi.fn(async () => true)
    expect(await oidcLinkRefusal({ requireVerifiedEmail: true, idpVerifiesEmail: true, storedSub: null, emailVerified: undefined, isProtectedAccount })).toBeNull()
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
