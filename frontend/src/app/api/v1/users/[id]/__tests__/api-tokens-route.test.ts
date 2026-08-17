/**
 * GET /users/[id]/api-tokens — the offboarding read (#632).
 *
 * This route exists so the user-admin dialogs can show, before disabling or
 * deleting an account, the credentials that will keep authenticating without
 * it. Three things must hold: it is gated by admin.users (not
 * admin.apitokens — the admin managing people may not hold the token right),
 * it resolves its target exactly like GET /users/[id] so a tenant-scoped
 * caller cannot probe ids from another tenant, and its projection carries
 * identifying fields ONLY — never a secret, never a hash.
 *
 * Runs against the real schema: the tenant name comes from a relation and the
 * live/dead split is a SQL predicate, so a mocked Prisma would assert nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock,
  isUserProtectedMock,
  isUserSuperAdminMock,
  getCurrentTenantIdMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  isUserProtectedMock: vi.fn<() => Promise<boolean>>(),
  isUserSuperAdminMock: vi.fn<() => Promise<boolean>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: 'admin.users' },
  isUserProtected: isUserProtectedMock,
  isUserSuperAdmin: isUserSuperAdminMock,
}))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: getCurrentTenantIdMock,
}))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const HASH = 'deadbeef'.repeat(8)
const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z')
const LONG_PAST = new Date('2020-01-01T00:00:00.000Z')

async function seedUser(id: string, tenantIds: string[]): Promise<void> {
  const now = new Date()
  await prismaTest.user.create({
    data: { id, email: `${id}@test.local`, createdAt: now, updatedAt: now },
  })
  for (const tenantId of tenantIds) {
    await prismaTest.userTenant.create({ data: { userId: id, tenantId, joinedAt: now } })
  }
}

async function seedToken(opts: {
  id: string
  createdByUserId: string | null
  tenantId?: string
  createdAt?: Date
  revokedAt?: Date | null
  expiresAt?: Date | null
  lastUsedAt?: Date | null
}): Promise<void> {
  await prismaTest.apiToken.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId ?? 'default',
      name: `name-of-${opts.id}`,
      tokenPrefix: `pxc_${opts.id}`,
      tokenHash: `${HASH}-${opts.id}`,
      scopes: ['vms:read', 'backups:read'],
      connectionIds: null,
      createdByUserId: opts.createdByUserId,
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: opts.revokedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
      lastUsedAt: opts.lastUsedAt ?? null,
    },
  })
}

async function importGET() {
  const mod = await import('../api-tokens/route')
  return mod.GET
}

beforeEach(async () => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  isUserProtectedMock.mockResolvedValue(false)
  isUserSuperAdminMock.mockResolvedValue(false)
  getCurrentTenantIdMock.mockResolvedValue('default')
  getServerSessionMock.mockResolvedValue({ user: { id: 'u-admin', email: 'admin@test.local' } })

  await truncate(['api_tokens', 'user_tenants', 'users', 'tenants'])
  await seedDefaultTenant()
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 't2', slug: 't2', name: 'Tenant Two', operatingModel: 'msp', createdAt: now, updatedAt: now },
  })
  await seedUser('u-leaver', ['default', 't2'])
})

describe('GET /users/[id]/api-tokens', () => {
  it('denies the read without admin.users', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    await seedToken({ id: 'live', createdByUserId: 'u-leaver' })
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-leaver' } })
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).not.toHaveProperty('data')
  })

  it('404s on a user id that does not exist', async () => {
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-ghost' } })
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toEqual({ error: 'Utilisateur non trouvé' })
  })

  it('404s (never 403) when the target is a protected account and the caller is not a super admin', async () => {
    isUserProtectedMock.mockResolvedValue(true)
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-leaver' } })
    expect(res.status).toBe(404)
  })

  it('projects the live tokens in snake_case with the tenant name, and no secret or hash', async () => {
    await seedToken({
      id: 'live',
      createdByUserId: 'u-leaver',
      lastUsedAt: new Date('2026-03-04T05:06:07.000Z'),
      expiresAt: FAR_FUTURE,
    })
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-leaver' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toEqual({
      id: 'live',
      name: 'name-of-live',
      token_prefix: 'pxc_live',
      tenant_id: 'default',
      tenant_name: 'Provider',
      scopes: ['vms:read', 'backups:read'],
      last_used_at: '2026-03-04T05:06:07.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    // Explicit: neither casing of the hash column, under any name, and not
    // as a raw substring anywhere in the payload either.
    expect(body.data[0].tokenHash).toBeUndefined()
    expect(body.data[0].token_hash).toBeUndefined()
    expect(body.data[0].secret).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(HASH)
  })

  it('omits the revoked and the expired tokens, keeps the ones that still authenticate', async () => {
    await seedToken({ id: 'live', createdByUserId: 'u-leaver' })
    await seedToken({ id: 'revoked', createdByUserId: 'u-leaver', revokedAt: new Date('2026-02-01T00:00:00.000Z') })
    await seedToken({ id: 'expired', createdByUserId: 'u-leaver', expiresAt: LONG_PAST })
    const GET = await importGET()
    const body = await readJson<any>(await callRoute(GET as any, { params: { id: 'u-leaver' } }))
    expect(body.data.map((t: any) => t.id)).toEqual(['live'])
  })

  it('shows every tenant to the provider view but only its own to a tenant-scoped admin', async () => {
    await seedToken({ id: 'live-default', createdByUserId: 'u-leaver', createdAt: new Date('2026-01-01T00:00:00.000Z') })
    await seedToken({ id: 'live-t2', createdByUserId: 'u-leaver', tenantId: 't2', createdAt: new Date('2026-01-02T00:00:00.000Z') })
    const GET = await importGET()

    const provider = await readJson<any>(await callRoute(GET as any, { params: { id: 'u-leaver' } }))
    expect(provider.data.map((t: any) => t.id)).toEqual(['live-t2', 'live-default'])

    getCurrentTenantIdMock.mockResolvedValue('t2')
    const scoped = await readJson<any>(await callRoute(GET as any, { params: { id: 'u-leaver' } }))
    expect(scoped.data.map((t: any) => t.id)).toEqual(['live-t2'])
  })

  it('404s for a tenant-scoped caller whose tenant the target does not belong to', async () => {
    getCurrentTenantIdMock.mockResolvedValue('t2')
    await seedUser('u-elsewhere', ['default'])
    await seedToken({ id: 'live-elsewhere', createdByUserId: 'u-elsewhere' })
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-elsewhere' } })
    expect(res.status).toBe(404)
  })

  it('returns an empty list, not a 404, for a user who never created a token', async () => {
    const GET = await importGET()
    const res = await callRoute(GET as any, { params: { id: 'u-leaver' } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: [] })
  })
})
