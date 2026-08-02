import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getCurrentTenantIdMock,
  userHasAccessToTenantMock, requireFeatureMock, auditMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  getRBACContextMock: vi.fn<() => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  userHasAccessToTenantMock: vi.fn<() => Promise<boolean>>(),
  requireFeatureMock: vi.fn<() => Promise<Response | null>>(),
  auditMock: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRBACContext: getRBACContextMock,
  PERMISSIONS: { ADMIN_APITOKENS: 'admin.apitokens' },
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: getCurrentTenantIdMock,
  userHasAccessToTenant: userHasAccessToTenantMock,
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: requireFeatureMock }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedApiToken, seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(async () => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('default')
  userHasAccessToTenantMock.mockResolvedValue(true)
  getRBACContextMock.mockResolvedValue({ userId: 'admin-1', isAdmin: true, tenantId: 'default' })
  auditMock.mockResolvedValue('audit-id')
  await truncate(['api_tokens', 'tenants', 'users', 'provider_connections', 'Connection'])
  await seedDefaultTenant()
  // api_tokens.created_by_user_id has a real FK to users; the default RBAC
  // mock above attributes creations to 'admin-1', so it must exist.
  const now = new Date()
  await prismaTest.user.create({
    data: { id: 'admin-1', email: 'admin-1@test.local', createdAt: now, updatedAt: now },
  })
})

describe('GET /api/v1/settings/api-tokens', () => {
  it('denies without admin.apitokens', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 }))
    const { GET } = await import('./route')
    expect((await callRoute(GET)).status).toBe(403)
  })

  it('lists tokens without ever returning the hash', async () => {
    await seedApiToken({ scopes: ['vms:read'] })
    const { GET } = await import('./route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].tokenPrefix).toMatch(/^pxc_/)
    expect(body.data[0].tokenHash).toBeUndefined()
  })

  it('non super admin sees only the current tenant', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    await seedApiToken({ tenantId: 'default' })
    await seedApiToken({ tenantId: 't2' })
    const { GET } = await import('./route')
    const body = await readJson<any>(await callRoute(GET))
    expect(body.data).toHaveLength(1)
    expect(body.data[0].tenantId).toBe('default')
  })
})

describe('POST /api/v1/settings/api-tokens', () => {
  const validBody = { name: 'prometheus-prod', scopes: ['vms:read', 'backups:read'] }

  it('is gated by requireFeature(api_access)', async () => {
    requireFeatureMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Feature not licensed', feature: 'api_access' }), { status: 403 }),
    )
    const { POST } = await import('./route')
    expect((await callRoute(POST, { body: validBody })).status).toBe(403)
  })

  it('creates a token and reveals the secret exactly once', async () => {
    // The pool-sync trigger is deferred to commit: Connection + ProviderConnection
    // must land in the same transaction for a default-tenant PVE connection.
    await prismaTest.$transaction([
      prismaTest.connection.create({
        data: { id: 'conn-a', tenantId: 'default', name: 'conn-a', baseUrl: 'https://pve-a:8006', apiTokenEnc: 'enc' },
      }),
      prismaTest.providerConnection.create({ data: { connectionId: 'conn-a' } }),
    ])
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, expiresInDays: 30, connectionIds: ['conn-a'] } })
    expect(res.status).toBe(201)
    const body = await readJson<any>(res)
    expect(body.data.secret).toMatch(/^pxc_[A-Za-z0-9_-]{43}$/)
    expect(body.data.token.tokenPrefix).toBe(body.data.secret.slice(0, 12))
    expect(body.data.token.tokenHash).toBeUndefined()
    expect(body.data.token.expiresAt).not.toBeNull()
    expect(body.data.token.connectionIds).toEqual(['conn-a'])
    const row = await prismaTest.apiToken.findUnique({ where: { id: body.data.token.id } })
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    // audit() now also receives the transaction client (fix round 1, finding
    // 1/2: the token row and its audit row are written atomically), so the
    // call has a second argument — match it loosely, the transactionality
    // itself is proven by apiTokensAuditAtomicity.test.ts.
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apitoken.create', category: 'api_tokens' }),
      expect.anything(),
    )
  })

  it('rejects unknown scopes, empty scopes and empty names with 400', async () => {
    const { POST } = await import('./route')
    expect((await callRoute(POST, { body: { name: 'x', scopes: ['bogus:read'] } })).status).toBe(400)
    expect((await callRoute(POST, { body: { name: 'x', scopes: [] } })).status).toBe(400)
    expect((await callRoute(POST, { body: { name: '', scopes: ['vms:read'] } })).status).toBe(400)
  })

  it('rejects a tenant the caller cannot access', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
    userHasAccessToTenantMock.mockResolvedValue(false)
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    const { POST } = await import('./route')
    expect((await callRoute(POST, { body: { ...validBody, tenantId: 't2' } })).status).toBe(403)
  })

  // Fix round 3, finding 1: connectionIds was only shape-checked, never
  // verified to belong to the target tenant. scope.ts drops a wrong id
  // silently at read time (fail-closed, no leak), but the token would then
  // see nothing rather than what its creator intended -- reject it here
  // instead of minting a blind token.
  it('rejects a connectionId that does not belong to the target tenant, with the same error shape as other 400s', async () => {
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    await prismaTest.connection.create({
      data: { id: 'conn-t2', tenantId: 't2', name: 'conn-t2', baseUrl: 'https://pve-t2:8006', apiTokenEnc: 'enc' },
    })
    const { POST } = await import('./route')
    // Target tenant is 'default' (ambient, no tenantId in the body); conn-t2 belongs to t2.
    const res = await callRoute(POST, { body: { ...validBody, connectionIds: ['conn-t2'] } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body).toEqual({ error: 'connectionIds must belong to the target tenant' })
    expect(await prismaTest.apiToken.findFirst({ where: { name: validBody.name } })).toBeNull()
  })

  it('accepts a connectionId list that legitimately belongs to the target tenant', async () => {
    await prismaTest.$transaction([
      prismaTest.connection.create({
        data: { id: 'conn-a', tenantId: 'default', name: 'conn-a', baseUrl: 'https://pve-a:8006', apiTokenEnc: 'enc' },
      }),
      prismaTest.connection.create({
        data: { id: 'conn-b', tenantId: 'default', name: 'conn-b', baseUrl: 'https://pve-b:8006', apiTokenEnc: 'enc' },
      }),
      prismaTest.providerConnection.create({ data: { connectionId: 'conn-a' } }),
      prismaTest.providerConnection.create({ data: { connectionId: 'conn-b' } }),
    ])
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, connectionIds: ['conn-a', 'conn-b'] } })
    expect(res.status).toBe(201)
    const body = await readJson<any>(res)
    expect(body.data.token.connectionIds).toEqual(['conn-a', 'conn-b'])
  })
})

describe('DELETE /api/v1/settings/api-tokens/{id}', () => {
  it('soft-revokes and keeps the row', async () => {
    const { id } = await seedApiToken()
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(res.status).toBe(200)
    const row = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(row).not.toBeNull()
    expect(row?.revokedAt).not.toBeNull()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apitoken.revoke' }),
      expect.anything(),
    )
  })

  it('404 on a token invisible to a non-admin of another tenant', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    const { id } = await seedApiToken({ tenantId: 't2' })
    const { DELETE } = await import('./[id]/route')
    expect((await callRoute(DELETE, { method: 'DELETE', params: { id } })).status).toBe(404)
  })
})
