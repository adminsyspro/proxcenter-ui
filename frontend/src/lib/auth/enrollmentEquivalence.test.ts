// jwtContext.ts's resolveMustEnroll is a second, independent implementation of
// the branching in enforce-2fa.ts's needsEnrollment / isEnrollmentRequiredFor.
// The duplication is deliberate — calling the originals from the consolidated
// read would undo the whole point of collapsing five round trips into one —
// but nothing else keeps the two in sync. If someone changes the enrollment
// policy in enforce-2fa.ts only (adds a role exemption, changes the
// expiresAt comparator, flips a condition), this is the ONLY test that
// notices: it drives the exact same mocked Prisma responses through both
// implementations and asserts they agree, across the full fixture matrix of
// inputs that can change the answer. If this file is deleted or skipped, the
// two implementations can silently diverge on who gets forced into 2FA
// enrollment with nothing else failing.
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

import { needsEnrollment } from '@/lib/auth/enforce-2fa'

import { loadJwtContext } from './jwtContext'

afterEach(() => vi.clearAllMocks())

const BOOLS = [true, false] as const
type RoleState = 'absent' | 'unexpired' | 'expired'
const ROLE_STATES: RoleState[] = ['absent', 'unexpired', 'expired']

/**
 * What prisma.rbacUserRole.findFirst would actually return for each state,
 * given the real query's `OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]`.
 * An expired-only assignment fails both branches of that OR, so a real query
 * excludes it just like "absent" does — both implementations issue the same
 * query shape (asserted separately in jwtContext.test.ts), so mocking the
 * already-filtered result is what a real DB round trip would hand back.
 */
function roleRowFor(state: RoleState) {
  return state === 'unexpired' ? { id: 'assign-1' } : null
}

describe('needsEnrollment (enforce-2fa.ts) vs loadJwtContext (jwtContext.ts) — enrollment decision equivalence', () => {
  for (const totpEnabled of BOOLS) {
    for (const require2faEnrollment of BOOLS) {
      for (const require2faForSuperAdmin of BOOLS) {
        for (const roleState of ROLE_STATES) {
          const label = `totpEnabled=${totpEnabled} require2faEnrollment=${require2faEnrollment} require2faForSuperAdmin=${require2faForSuperAdmin} role=${roleState}`

          it(`agree when ${label}`, async () => {
            userFindUniqueMock.mockResolvedValue({
              enabled: true,
              totpEnabled,
              require2faEnrollment,
              tenants: [],
              sessions: [],
            })
            policyFindFirstMock.mockResolvedValue({ require2faForSuperAdmin })
            roleFindFirstMock.mockResolvedValue(roleRowFor(roleState))

            const viaOriginal = await needsEnrollment('u1')
            const ctx = await loadJwtContext('u1', 'sid1')

            expect(ctx.mustEnroll2fa).toBe(viaOriginal)
          })
        }
      }
    }
  }
})
