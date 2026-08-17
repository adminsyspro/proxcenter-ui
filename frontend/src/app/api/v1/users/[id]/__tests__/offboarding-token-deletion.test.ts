/**
 * PATCH / DELETE /users/[id] — opt-in API token deletion on offboarding (#632).
 *
 * A pxc_ token authenticates on its own row: it survives the disabling or the
 * deletion of the account that minted it, by design (spec D3 — a departure
 * must not take Prometheus down). The product arbitration is therefore that
 * the admin decides, explicitly, in the same gesture:
 *
 *   - PATCH { deleteApiTokens: true } and DELETE ?deleteApiTokens=true remove
 *     the token rows outright. On owner arbitration this is a hard delete, not
 *     the revocation stamp it started as: "supprimer" has to mean the token is
 *     gone. What survives is the audit entry, which names the prefixes
 *     (audit_logs.api_token_id carries no foreign key precisely so a journal
 *     line can outlive the row it describes).
 *   - The same requests WITHOUT the flag must delete nothing. That negative is
 *     the feature, not an oversight: an implicit deletion would silently
 *     break integrations during an offboarding, which is the failure mode the
 *     spec chose to avoid.
 *
 * Two orderings also matter, and both are asserted below:
 *   - PATCH deletes BEFORE prisma.user.update, so a deletion failure aborts
 *     the request with the account still enabled rather than leaving an admin
 *     believing the tokens died with the account.
 *   - DELETE deletes the tokens BEFORE the account, because
 *     created_by_user_id is ON DELETE SET NULL: after the delete the tokens
 *     can no longer be found by creator and the chance is lost for good. The
 *     evidence for that ordering is the NON-ZERO count in the response — had
 *     the sweep run after the account delete, the creator link would already
 *     be NULL and it would have found, and reported, nothing.
 *
 * Real Postgres: the SET NULL behaviour, the disappearance of a row and the
 * survival of created_by_email are database facts, unobservable through a
 * mocked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock,
  isUserProtectedMock,
  isUserSuperAdminMock,
  getCurrentTenantIdMock,
  getServerSessionMock,
  hashPasswordMock,
  auditMock,
  revokeAllSessionsMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  isUserProtectedMock: vi.fn<() => Promise<boolean>>(),
  isUserSuperAdminMock: vi.fn<() => Promise<boolean>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
  hashPasswordMock: vi.fn<() => Promise<string>>(),
  auditMock: vi.fn<() => Promise<string>>(),
  revokeAllSessionsMock: vi.fn<() => Promise<number>>(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: hashPasswordMock }))
vi.mock('@/lib/auth/sessions', () => ({ revokeAllSessions: revokeAllSessionsMock }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: 'admin.users' },
  isUserProtected: isUserProtectedMock,
  isUserSuperAdmin: isUserSuperAdminMock,
  PROTECTED_ROLE_IDS: ['role_super_admin', 'role_provider_admin'],
  PROVIDER_ONLY_ROLE_IDS: ['role_operator', 'role_vm_admin', 'role_viewer', 'role_vm_user'],
}))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: getCurrentTenantIdMock,
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { prisma } from '@/lib/db/prisma'

const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z')
const LONG_PAST = new Date('2020-01-01T00:00:00.000Z')
const ALREADY_REVOKED_AT = new Date('2026-02-01T00:00:00.000Z')

async function seedUser(id: string, tenantIds: string[]): Promise<void> {
  const now = new Date()
  await prismaTest.user.create({
    data: { id, email: `${id}@test.local`, name: id, createdAt: now, updatedAt: now },
  })
  for (const tenantId of tenantIds) {
    await prismaTest.userTenant.create({ data: { userId: id, tenantId, joinedAt: now } })
  }
}

async function seedToken(opts: {
  id: string
  createdByUserId: string | null
  tenantId?: string
  revokedAt?: Date | null
  expiresAt?: Date | null
}): Promise<void> {
  await prismaTest.apiToken.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId ?? 'default',
      name: `name-of-${opts.id}`,
      tokenPrefix: `pxc_${opts.id}`,
      tokenHash: `hash-of-${opts.id}`,
      scopes: ['vms:read'],
      connectionIds: null,
      createdByUserId: opts.createdByUserId,
      createdByEmail: opts.createdByUserId ? `${opts.createdByUserId}@test.local` : null,
      revokedAt: opts.revokedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
    },
  })
}

function tokenRow(id: string) {
  return prismaTest.apiToken.findUnique({ where: { id } })
}

// Deliberately not `(await tokenRow(id))?.someColumn`: on a missing row that
// reads back as `undefined`, which quietly satisfies most negative matchers.
// Row disappearance is the assertion here, so it is checked on the row itself.
async function exists(id: string): Promise<boolean> {
  return (await tokenRow(id)) !== null
}

async function importRoute() {
  return await import('../route')
}

beforeEach(async () => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  isUserProtectedMock.mockResolvedValue(false)
  isUserSuperAdminMock.mockResolvedValue(false)
  getCurrentTenantIdMock.mockResolvedValue('default')
  getServerSessionMock.mockResolvedValue({ user: { id: 'u-admin', email: 'admin@test.local' } })
  hashPasswordMock.mockResolvedValue('hashed')
  auditMock.mockResolvedValue('audit-id')
  revokeAllSessionsMock.mockResolvedValue(0)

  await truncate(['api_tokens', 'audit_logs', 'sessions', 'rbac_user_roles', 'rbac_user_permissions', 'user_tenants', 'users', 'tenants'])
  await seedDefaultTenant()
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 't2', slug: 't2', name: 'Tenant Two', operatingModel: 'msp', createdAt: now, updatedAt: now },
  })
  await seedUser('u-leaver', ['default', 't2'])
  await seedUser('u-stays', ['default'])

  await seedToken({ id: 'live-default', createdByUserId: 'u-leaver' })
  await seedToken({ id: 'live-t2', createdByUserId: 'u-leaver', tenantId: 't2' })
  await seedToken({ id: 'revoked', createdByUserId: 'u-leaver', revokedAt: ALREADY_REVOKED_AT })
  await seedToken({ id: 'expired', createdByUserId: 'u-leaver', expiresAt: LONG_PAST })
  await seedToken({ id: 'live-of-u-stays', createdByUserId: 'u-stays', expiresAt: FAR_FUTURE })
})

describe('PATCH /users/[id] — deleteApiTokens', () => {
  it('deletes the live tokens when the admin ticks the box while disabling the account', async () => {
    const { PATCH } = await importRoute()
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'u-leaver' },
      body: { enabled: false, deleteApiTokens: true },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.data.enabled).toBe(false)
    expect(json.data.api_tokens_deleted).toBe(2)

    // Gone from the database, not stamped.
    expect(await exists('live-default')).toBe(false)
    expect(await exists('live-t2')).toBe(false)
    // A dead token is not offered to the admin, so it is not swept either; and
    // another creator's token is never in scope.
    expect(await exists('revoked')).toBe(true)
    expect((await tokenRow('revoked'))?.revokedAt).toEqual(ALREADY_REVOKED_AT)
    expect(await exists('expired')).toBe(true)
    expect(await exists('live-of-u-stays')).toBe(true)

    const details = auditMock.mock.calls[0]![0] as any
    expect(details.details.apiTokensDeleted.count).toBe(2)
    expect([...details.details.apiTokensDeleted.prefixes].sort()).toEqual(['pxc_live-default', 'pxc_live-t2'])
  })

  it('deletes NOTHING when the same disable comes without the flag', async () => {
    const { PATCH } = await importRoute()
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'u-leaver' },
      body: { enabled: false },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.data.enabled).toBe(false)
    expect(json.data.api_tokens_deleted).toBe(0)

    expect(await exists('live-default')).toBe(true)
    expect(await exists('live-t2')).toBe(true)
    expect(await prismaTest.apiToken.count()).toBe(5)

    const audited = auditMock.mock.calls[0]![0] as any
    expect(audited.details).not.toHaveProperty('apiTokensDeleted')
  })

  it('accepts a PATCH that carries only deleteApiTokens, instead of 400 "Aucune modification fournie"', async () => {
    const { PATCH } = await importRoute()
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'u-leaver' },
      body: { deleteApiTokens: true },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.error).toBeUndefined()
    expect(json.data.api_tokens_deleted).toBe(2)
    // No account field was submitted, so the account itself is untouched.
    expect(json.data.enabled).toBe(true)
    expect(await exists('live-default')).toBe(false)
  })

  it('confines a tenant-scoped admin to the tokens of the tenant they act from', async () => {
    getCurrentTenantIdMock.mockResolvedValue('t2')
    const { PATCH } = await importRoute()
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'u-leaver' },
      body: { enabled: false, deleteApiTokens: true },
    })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.api_tokens_deleted).toBe(1)
    expect(await exists('live-t2')).toBe(false)
    expect(await exists('live-default')).toBe(true)
  })

  it('aborts with the account still enabled when the deletion fails (deletion runs first)', async () => {
    const deleteMany = vi.spyOn(prisma.apiToken, 'deleteMany').mockRejectedValueOnce(new Error('token store unreachable'))
    try {
      const { PATCH } = await importRoute()
      const res = await callRoute(PATCH as any, {
        method: 'PATCH',
        params: { id: 'u-leaver' },
        body: { enabled: false, deleteApiTokens: true },
      })

      expect(res.status).toBe(500)
      expect(await readJson<any>(res)).toEqual({ error: 'token store unreachable' })
    } finally {
      deleteMany.mockRestore()
    }

    // The whole point of the ordering: nobody was left believing the tokens
    // died with an account that is, in fact, still enabled.
    expect((await prismaTest.user.findUnique({ where: { id: 'u-leaver' } }))?.enabled).toBe(true)
    expect(auditMock).not.toHaveBeenCalled()
    expect(await exists('live-default')).toBe(true)
  })
})

describe('DELETE /users/[id] — ?deleteApiTokens=true', () => {
  it('deletes the tokens before the account, which is why the reported count is not zero', async () => {
    const { DELETE } = await importRoute()
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'u-leaver' },
      searchParams: { deleteApiTokens: 'true' },
    })

    expect(res.status).toBe(200)
    // 2, not 0: had the deletion run after the account delete,
    // created_by_user_id would already be NULL and nothing would have been
    // found by creator. The count IS the proof of the ordering.
    expect(await readJson<any>(res)).toEqual({ success: true, api_tokens_deleted: 2 })

    expect(await prismaTest.user.findUnique({ where: { id: 'u-leaver' } })).toBeNull()

    expect(await exists('live-default')).toBe(false)
    expect(await exists('live-t2')).toBe(false)
    expect(await exists('live-of-u-stays')).toBe(true)

    // The audit entry is what outlives the rows, and the prefixes are the only
    // identifier left to say which integrations just lost their credential.
    const audited = auditMock.mock.calls[0]![0] as any
    expect(audited.action).toBe('delete')
    expect(audited.details.apiTokensDeleted.count).toBe(2)
    expect([...audited.details.apiTokensDeleted.prefixes].sort()).toEqual(['pxc_live-default', 'pxc_live-t2'])
  })

  it('leaves the tokens alive, orphaned on created_by_user_id, when the parameter is absent', async () => {
    const { DELETE } = await importRoute()
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'u-leaver' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true, api_tokens_deleted: 0 })
    expect(await prismaTest.user.findUnique({ where: { id: 'u-leaver' } })).toBeNull()

    for (const id of ['live-default', 'live-t2']) {
      const row = await tokenRow(id)
      expect(row).not.toBeNull()
      // ON DELETE SET NULL: this is exactly why the deletion cannot be
      // deferred to a later request — the creator link is gone.
      expect(row?.createdByUserId).toBeNull()
      // ...and exactly why created_by_email is frozen on the row: provenance
      // has to outlive the account for every token the operator chose to keep.
      expect(row?.createdByEmail).toBe('u-leaver@test.local')
    }

    const audited = auditMock.mock.calls[0]![0] as any
    expect(audited.details).toEqual({})
  })

  it('treats ?deleteApiTokens=false as no deletion at all', async () => {
    const { DELETE } = await importRoute()
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'u-leaver' },
      searchParams: { deleteApiTokens: 'false' },
    })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).api_tokens_deleted).toBe(0)
    expect(await exists('live-default')).toBe(true)
  })
})
