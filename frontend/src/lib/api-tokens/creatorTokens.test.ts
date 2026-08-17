/**
 * listActiveTokensCreatedBy / deleteTokensCreatedBy — offboarding helpers (#632).
 *
 * The whole point of these two functions is the definition of "would still
 * authenticate": not revoked AND not past its expiry. Everything else in the
 * offboarding UX (the warning, the checkbox, the audit line) is derived from
 * that set, so a token wrongly included pads the warning with credentials
 * nobody has to decide about, and a token wrongly excluded is exactly the
 * silent survivor the issue is about.
 *
 * On owner arbitration, "delete a token" means the ROW IS GONE — there is no
 * soft revocation on the write path any more. `revokedAt` survives as a READ
 * filter only: existing databases still hold rows stamped back when the delete
 * button was a revocation, and those must keep being excluded from the
 * offboarding list. Both halves are asserted below.
 *
 * Backed by the real Postgres schema rather than a mocked Prisma: the where
 * clause (a null-or-future OR, plus an optional tenant narrowing) is the unit
 * under test, and a mock would only ever assert the shape of an object we
 * wrote ourselves. Row disappearance is likewise a database fact.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { prisma } from '@/lib/db/prisma'
import { deleteTokensCreatedBy, listActiveTokensCreatedBy } from './creatorTokens'

const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z')
const LONG_PAST = new Date('2020-01-01T00:00:00.000Z')
const ALREADY_REVOKED_AT = new Date('2026-02-01T00:00:00.000Z')

// A hash that no projection has any business carrying around, distinctive
// enough to be searched for as a plain substring.
const HASH = 'deadbeef'.repeat(8)

async function seedUser(id: string): Promise<void> {
  const now = new Date()
  await prismaTest.user.create({
    data: { id, email: `${id}@test.local`, createdAt: now, updatedAt: now },
  })
}

async function seedToken(opts: {
  id: string
  createdByUserId: string | null
  tenantId?: string
  createdAt?: Date
  revokedAt?: Date | null
  expiresAt?: Date | null
  lastUsedAt?: Date | null
  scopes?: string[]
}): Promise<void> {
  await prismaTest.apiToken.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId ?? 'default',
      name: `name-of-${opts.id}`,
      tokenPrefix: `pxc_${opts.id}`,
      tokenHash: `${HASH}-${opts.id}`,
      scopes: opts.scopes ?? ['vms:read'],
      connectionIds: null,
      createdByUserId: opts.createdByUserId,
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: opts.revokedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
      lastUsedAt: opts.lastUsedAt ?? null,
    },
  })
}

function rowOf(id: string) {
  return prismaTest.apiToken.findUnique({ where: { id }, select: { id: true, revokedAt: true } })
}

// `rowOf(...)?.revokedAt` would silently pass on a missing row (undefined is
// not null), which is precisely the confusion this suite has to rule out — so
// existence is asserted through the row itself, never through one of its
// columns.
async function exists(id: string): Promise<boolean> {
  return (await rowOf(id)) !== null
}

beforeEach(async () => {
  await truncate(['api_tokens', 'user_tenants', 'users', 'tenants'])
  await seedDefaultTenant()
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 't2', slug: 't2', name: 'Tenant Two', operatingModel: 'msp', createdAt: now, updatedAt: now },
  })
  await seedUser('u-leaver')
  await seedUser('u-stays')

  // Everything below is created by the departing user unless stated.
  await seedToken({ id: 'live-no-expiry', createdByUserId: 'u-leaver', createdAt: new Date('2026-01-01T00:00:00.000Z') })
  await seedToken({ id: 'live-future-expiry', createdByUserId: 'u-leaver', createdAt: new Date('2026-01-02T00:00:00.000Z'), expiresAt: FAR_FUTURE })
  await seedToken({ id: 'live-other-tenant', createdByUserId: 'u-leaver', createdAt: new Date('2026-01-03T00:00:00.000Z'), tenantId: 't2' })
  await seedToken({ id: 'already-revoked', createdByUserId: 'u-leaver', revokedAt: ALREADY_REVOKED_AT })
  await seedToken({ id: 'expired', createdByUserId: 'u-leaver', expiresAt: LONG_PAST })
  await seedToken({ id: 'other-creator', createdByUserId: 'u-stays' })
  // created_by_user_id is SetNull: a token whose creator was already deleted
  // must never be swept up by a query keyed on a creator id.
  await seedToken({ id: 'orphan', createdByUserId: null })
})

describe('listActiveTokensCreatedBy', () => {
  it('lists every live token of that creator across tenants, newest first', async () => {
    const rows = await listActiveTokensCreatedBy('u-leaver')
    expect(rows.map(r => r.id)).toEqual(['live-other-tenant', 'live-future-expiry', 'live-no-expiry'])
  })

  it('keeps a token whose expiry is in the future but drops the revoked and the expired one', async () => {
    const ids = (await listActiveTokensCreatedBy('u-leaver')).map(r => r.id)
    expect(ids).toContain('live-future-expiry')
    expect(ids).not.toContain('already-revoked')
    expect(ids).not.toContain('expired')
  })

  it('never lists a token created by somebody else, nor one with no creator at all', async () => {
    const ids = (await listActiveTokensCreatedBy('u-leaver')).map(r => r.id)
    expect(ids).not.toContain('other-creator')
    expect(ids).not.toContain('orphan')
    expect((await listActiveTokensCreatedBy('u-stays')).map(r => r.id)).toEqual(['other-creator'])
  })

  it('narrows to a single tenant when tenantId is given, and includes foreign tenants when it is not', async () => {
    const scoped = await listActiveTokensCreatedBy('u-leaver', 'default')
    expect(scoped.map(r => r.id)).toEqual(['live-future-expiry', 'live-no-expiry'])
    expect(scoped.map(r => r.id)).not.toContain('live-other-tenant')

    const scopedToT2 = await listActiveTokensCreatedBy('u-leaver', 't2')
    expect(scopedToT2.map(r => r.id)).toEqual(['live-other-tenant'])

    const unscoped = await listActiveTokensCreatedBy('u-leaver')
    expect(unscoped.map(r => r.id)).toContain('live-other-tenant')
  })

  it('flattens the row and resolves the tenant name from the relation, without the hash', async () => {
    const rows = await listActiveTokensCreatedBy('u-leaver', 't2')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id: 'live-other-tenant',
      name: 'name-of-live-other-tenant',
      tokenPrefix: 'pxc_live-other-tenant',
      tenantId: 't2',
      tenantName: 'Tenant Two',
      scopes: ['vms:read'],
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    })
    expect(JSON.stringify(rows)).not.toContain(HASH)
  })

  it('returns an empty array for a creator with nothing live', async () => {
    expect(await listActiveTokensCreatedBy('u-nobody')).toEqual([])
  })
})

describe('deleteTokensCreatedBy', () => {
  it('removes only the live tokens and reports what it deleted', async () => {
    const deleteMany = vi.spyOn(prisma.apiToken, 'deleteMany')
    try {
      const result = await deleteTokensCreatedBy('u-leaver')

      expect(result.count).toBe(3)
      expect(result.tokens.map(t => t.id).sort()).toEqual(['live-future-expiry', 'live-no-expiry', 'live-other-tenant'])
      expect(result.tokens.map(t => t.tokenPrefix).sort()).toEqual([
        'pxc_live-future-expiry',
        'pxc_live-no-expiry',
        'pxc_live-other-tenant',
      ])
      // Proves the spy below (and the "never issues a DELETE" test) is wired
      // to the call the function actually makes.
      expect(deleteMany).toHaveBeenCalledTimes(1)
    } finally {
      deleteMany.mockRestore()
    }

    // The rows are GONE, not stamped: this is the whole behaviour change.
    expect(await exists('live-no-expiry')).toBe(false)
    expect(await exists('live-future-expiry')).toBe(false)
    expect(await exists('live-other-tenant')).toBe(false)
  })

  it('leaves the expired token and the already-revoked one in place, untouched', async () => {
    await deleteTokensCreatedBy('u-leaver')
    // Neither is offered to the admin, so neither is deleted either: the two
    // filters that exclude them from the LIST also exclude them from the sweep.
    expect(await exists('expired')).toBe(true)
    expect((await rowOf('expired'))?.revokedAt).toBeNull()
    expect(await exists('already-revoked')).toBe(true)
    expect((await rowOf('already-revoked'))?.revokedAt).toEqual(ALREADY_REVOKED_AT)
  })

  it('never touches a token created by somebody else: those rows still exist afterwards', async () => {
    const result = await deleteTokensCreatedBy('u-leaver')
    expect(result.tokens.map(t => t.id)).not.toContain('other-creator')
    expect(await exists('other-creator')).toBe(true)
    expect(await exists('orphan')).toBe(true)
  })

  it('confines the deletion to the given tenant', async () => {
    const result = await deleteTokensCreatedBy('u-leaver', 'default')
    expect(result.count).toBe(2)
    expect(result.tokens.map(t => t.id).sort()).toEqual(['live-future-expiry', 'live-no-expiry'])
    expect(await exists('live-other-tenant')).toBe(true)
  })

  it('is a hard delete: the table shrinks by exactly the tokens it reported', async () => {
    const before = await prismaTest.apiToken.count()
    const result = await deleteTokensCreatedBy('u-leaver')
    expect(await prismaTest.apiToken.count()).toBe(before - result.count)
    // Belt and braces on the count arithmetic: 3 of the 7 seeded rows go, and
    // the survivors are named rather than merely counted.
    expect(result.count).toBe(3)
    expect((await prismaTest.apiToken.findMany({ select: { id: true } })).map(r => r.id).sort()).toEqual([
      'already-revoked',
      'expired',
      'orphan',
      'other-creator',
    ])
  })

  it('returns a zero count and never issues a DELETE when there is nothing live to remove', async () => {
    const deleteMany = vi.spyOn(prisma.apiToken, 'deleteMany')
    try {
      // u-stays' only token is live, so use a creator whose whole set is dead.
      await prismaTest.apiToken.updateMany({ where: { createdByUserId: 'u-leaver' }, data: { revokedAt: ALREADY_REVOKED_AT } })
      deleteMany.mockClear()

      expect(await deleteTokensCreatedBy('u-leaver')).toEqual({ count: 0, tokens: [] })
      expect(deleteMany).not.toHaveBeenCalled()
    } finally {
      deleteMany.mockRestore()
    }

    // Nothing was swept, so nothing was lost either.
    expect(await prismaTest.apiToken.count()).toBe(7)
  })
})
