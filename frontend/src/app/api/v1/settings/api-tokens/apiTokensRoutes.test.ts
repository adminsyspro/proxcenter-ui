import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getCurrentTenantIdMock,
  userHasAccessToTenantMock, requireFeatureMock, auditMock, holdsMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  getRBACContextMock: vi.fn<() => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  userHasAccessToTenantMock: vi.fn<() => Promise<boolean>>(),
  requireFeatureMock: vi.fn<() => Promise<Response | null>>(),
  auditMock: vi.fn<(...a: any[]) => Promise<string>>(),
  holdsMock: vi.fn<(...a: any[]) => Promise<boolean>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRBACContext: getRBACContextMock,
  holdsBroadPermission: holdsMock,
  PERMISSIONS: { ADMIN_APITOKENS: 'admin.apitokens' },
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: getCurrentTenantIdMock,
  userHasAccessToTenant: userHasAccessToTenantMock,
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: requireFeatureMock }))
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its
  // own (#1105); the stand-in must do the same or every explicit row doubles.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: any[]) => { markAuditExplicit(); return auditMock(...a) } }
})

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
  holdsMock.mockResolvedValue(true)
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

  // Owner feedback round: the frontend needs the tenant NAME, not just its
  // opaque cuid, to render a Tenant column -- joined server-side rather than
  // making the tab fetch /api/v1/tenants itself (that route needs
  // ADMIN_TENANTS, which an admin.apitokens holder may not have).
  it('joins the tenant name alongside tenantId', async () => {
    await seedApiToken({ scopes: ['vms:read'] })
    const { GET } = await import('./route')
    const body = await readJson<any>(await callRoute(GET))
    expect(body.data[0].tenantId).toBe('default')
    expect(body.data[0].tenant).toEqual({ name: 'Provider' })
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

  // _shared.ts's requireApiTokenAdmin: the permission check can pass while
  // the principal itself no longer resolves (e.g. a session that expired
  // between the permission check and the context load) -- this must still
  // fail closed with 401, never proceed with an undefined ctx.
  it('401s when the permission check passes but the RBAC context cannot be resolved', async () => {
    getRBACContextMock.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await callRoute(GET)
    expect(res.status).toBe(401)
    expect(await readJson<any>(res)).toEqual({ error: 'Not authenticated' })
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

  it('denies creation when admin.apitokens is missing, before even consulting the licence gate', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 }))
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(403)
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })

  it('rejects a body whose name is missing (not a string) with the same 400 as an empty name', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { scopes: ['vms:read'] } })
    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'name is required' })
  })

  it('rejects a connectionIds value that is not an array at all (shape check, before the ownership check)', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, connectionIds: 'conn-a' } })
    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'connectionIds must be null or an array of connection ids' })
    expect(await prismaTest.apiToken.findFirst({ where: { name: validBody.name } })).toBeNull()
  })

  it('rejects vdcs:write on a token restricted to connections (issue #1360): its writes reach every connection', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, scopes: ['vdcs:write'], connectionIds: ['conn-a'] } })
    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({
      error: 'vdcs:write reaches every connection: it needs a token not restricted to connections',
      scope: 'vdcs:write',
    })
    expect(await prismaTest.apiToken.findFirst({ where: { name: validBody.name } })).toBeNull()
  })

  it('rejects a target tenant that does not exist, with the same body as a disabled one', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, tenantId: 'no-such-tenant' } })
    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'Target tenant is disabled or missing' })
  })

  it('rejects a non-positive or non-finite expiresInDays', async () => {
    const { POST } = await import('./route')
    const negative = await callRoute(POST, { body: { ...validBody, expiresInDays: -5 } })
    expect(negative.status).toBe(400)
    expect(await readJson<any>(negative)).toEqual({ error: 'expiresInDays must be a positive number' })
    const notANumber = await callRoute(POST, { body: { ...validBody, name: 'other', expiresInDays: 'soon' } })
    expect(notANumber.status).toBe(400)
    expect(await readJson<any>(notANumber)).toEqual({ error: 'expiresInDays must be a positive number' })
  })

  it('honours an explicit, valid rateLimitPerMin instead of the 600 default', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, rateLimitPerMin: 120 } })
    expect(res.status).toBe(201)
    const body = await readJson<any>(res)
    expect(body.data.token.rateLimitPerMin).toBe(120)
  })

  it('falls back to the 600 default when rateLimitPerMin is present but not a positive number', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { ...validBody, rateLimitPerMin: -3 } })
    expect(res.status).toBe(201)
    const body = await readJson<any>(res)
    expect(body.data.token.rateLimitPerMin).toBe(600)
  })

  it('defaults writeRateLimitPerMin to 60 and honours an explicit value', async () => {
    const { POST } = await import('./route')
    const dflt = await readJson<any>(await callRoute(POST, { body: validBody }))
    expect(dflt.data.token.writeRateLimitPerMin).toBe(60)
    const set = await readJson<any>(await callRoute(POST, { body: { ...validBody, name: 'w', writeRateLimitPerMin: 12.7 } }))
    expect(set.data.token.writeRateLimitPerMin).toBe(12)
    const bad = await readJson<any>(await callRoute(POST, { body: { ...validBody, name: 'w2', writeRateLimitPerMin: -1 } }))
    expect(bad.data.token.writeRateLimitPerMin).toBe(60)
  })

  describe('anti-escalation', () => {
    const asUser = () => getRBACContextMock.mockResolvedValue({ userId: 'admin-1', isAdmin: false, tenantId: 'default' })

    it('refuses a write scope the creator does not hold, naming it', async () => {
      asUser()
      holdsMock.mockImplementation(async (_u, _t, key) => key === 'vm.view')
      const { POST } = await import('./route')
      const res = await callRoute(POST, { body: { name: 'x', scopes: ['vms:read', 'vms:power'] } })
      expect(res.status).toBe(403)
      expect(await readJson<any>(res)).toEqual({ error: 'You cannot grant a scope you do not hold', scope: 'vms:power' })
      expect(await prismaTest.apiToken.findFirst({ where: { name: 'x' } })).toBeNull()
    })

    it('a held-rights lookup that fails is a 503 with a generic message, and mints nothing', async () => {
      asUser()
      holdsMock.mockRejectedValue(new Error('db down: secret details'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { POST } = await import('./route')
      const res = await callRoute(POST, { body: { name: 'x', scopes: ['vms:power'] } })
      expect(res.status).toBe(503)
      expect(await readJson<any>(res)).toEqual({ error: 'Unable to verify the scopes you can grant' })
      expect(await prismaTest.apiToken.findFirst({ where: { name: 'x' } })).toBeNull()
      errSpy.mockRestore()
    })

    it('accepts read-only scopes without consulting holdsBroadPermission', async () => {
      asUser()
      holdsMock.mockResolvedValue(false)
      const { POST } = await import('./route')
      const res = await callRoute(POST, { body: { name: 'x', scopes: ['vms:read'] } })
      expect(res.status).toBe(201)
      expect(holdsMock).not.toHaveBeenCalled()
    })

    it('checks held rights against the final tenant and connections, not the ambient ones', async () => {
      asUser()
      const now = new Date()
      await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
      await prismaTest.connection.create({
        data: { id: 'c1', tenantId: 't2', name: 'c1', baseUrl: 'https://pve-c1:8006', apiTokenEnc: 'enc' },
      })
      const { POST } = await import('./route')
      const body = { name: 'x', tenantId: 't2', connectionIds: ['c1'], scopes: ['vms:snapshot'] }
      const ok = await callRoute(POST, { body })
      expect(ok.status).toBe(201)
      expect(holdsMock).toHaveBeenCalledWith('admin-1', 't2', 'vm.snapshot', ['c1'])

      holdsMock.mockImplementation(async (_u, tenant) => tenant !== 't2')
      const denied = await callRoute(POST, { body: { ...body, name: 'y' } })
      expect(denied.status).toBe(403)
      expect((await readJson<any>(denied)).scope).toBe('vms:snapshot')
    })

    it('lets a super admin mint any scope without checks', async () => {
      holdsMock.mockResolvedValue(false)
      const { POST } = await import('./route')
      const res = await callRoute(POST, { body: { name: 'x', scopes: ['vms:delete'] } })
      expect(res.status).toBe(201)
      expect(holdsMock).not.toHaveBeenCalled()
    })

    it('fails closed for a non-admin without a user id', async () => {
      getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default' })
      const { POST } = await import('./route')
      const res = await callRoute(POST, { body: { name: 'x', scopes: ['vms:power'] } })
      expect(res.status).toBe(403)
      expect((await readJson<any>(res)).scope).toBe('vms:power')
    })
  })

  it('stores a provided description, and treats an empty string as absent (null)', async () => {
    const { POST } = await import('./route')
    const withDescription = await callRoute(POST, { body: { ...validBody, description: 'used by Grafana' } })
    const withBody = await readJson<any>(withDescription)
    expect(withBody.data.token.description).toBe('used by Grafana')

    const withEmpty = await callRoute(POST, { body: { ...validBody, name: 'other-token', description: '' } })
    const emptyBody = await readJson<any>(withEmpty)
    expect(emptyBody.data.token.description).toBeNull()
  })

  it('defaults createdByUserId to null when the RBAC context carries no userId', async () => {
    getRBACContextMock.mockResolvedValue({ isAdmin: true, tenantId: 'default' })
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(201)
    const body = await readJson<any>(res)
    const row = await prismaTest.apiToken.findUnique({ where: { id: body.data.token.id } })
    expect(row?.createdByUserId).toBeNull()
  })

  it('falls back to a generic 500 message when the transaction failure carries no message', async () => {
    auditMock.mockRejectedValueOnce({})
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Internal server error' })
    expect(await prismaTest.apiToken.findFirst({ where: { name: validBody.name } })).toBeNull()
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
    expect(body.data.token.tenant).toEqual({ name: 'Provider' })
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
  // Owner arbitration: the row is REMOVED, it is no longer stamped with
  // revoked_at. The audit entry is what remains, carrying the prefix -- the
  // only identifier that survives the row.
  it('deletes the row outright and journals apitoken.delete with the prefix', async () => {
    const { id, prefix } = await seedApiToken()
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { id, deleted: true } })
    const row = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(row).toBeNull()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apitoken.delete', details: { tokenPrefix: prefix } }),
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

  it('denies deletion when admin.apitokens is missing', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 }))
    const { id } = await seedApiToken()
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(res.status).toBe(403)
    // On a hard delete the survival of the row is the whole assertion: reading
    // `row?.revokedAt` would pass just as happily on a row that was removed.
    expect(await prismaTest.apiToken.findUnique({ where: { id } })).not.toBeNull()
  })

  it('400s when params.id is missing entirely', async () => {
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'Missing params.id' })
  })

  // The route is deliberately NOT idempotent any more, unlike the revocation
  // it replaces (which answered 200 forever). Once the row is gone 404 is the
  // honest answer, and the only caller reloads the list rather than reading
  // this response.
  it('answers 404 on a second DELETE of the same id, and only withAudit() journals the second time', async () => {
    const { id } = await seedApiToken()
    const { DELETE } = await import('./[id]/route')

    const first = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(first.status).toBe(200)
    expect(auditMock).toHaveBeenCalledTimes(1)

    const second = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(second.status).toBe(404)
    expect(await readJson<any>(second)).toEqual({ error: 'API token not found' })
    // The lookup fails before the transaction, so the route writes no second
    // apitoken.delete entry; the 404 itself is journalled by withAudit()'s
    // safety-net row (#1105), outside any transaction.
    expect(auditMock).toHaveBeenCalledTimes(2)
    expect(auditMock.mock.calls[1]).toHaveLength(1)
    expect(auditMock.mock.calls[1][0]).toMatchObject({
      category: 'api_tokens', action: 'delete', resourceType: 'api_token', resourceId: id, status: 'failure',
      errorMessage: 'API token not found', details: expect.objectContaining({ method: 'DELETE', httpStatus: 404 }),
    })
  })

  // A legacy row still carrying revoked_at from the soft-revocation era is
  // deletable like any other: the route keys on the row, not on its state.
  it('deletes a legacy already-revoked row instead of refusing it', async () => {
    const { id } = await seedApiToken({ revokedAt: new Date('2026-01-01T00:00:00.000Z') })
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { id, deleted: true } })
    expect(await prismaTest.apiToken.findUnique({ where: { id } })).toBeNull()
  })

  it('falls back to a generic 500 message when the delete transaction failure carries no message', async () => {
    auditMock.mockRejectedValueOnce({})
    const { id } = await seedApiToken()
    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Internal server error' })
    // Rolled back with the audit insert: the credential is still there.
    expect(await prismaTest.apiToken.findUnique({ where: { id } })).not.toBeNull()
  })
})

describe('POST /api/v1/settings/api-tokens/{id}/rotate', () => {
  const rotate = async (id: string) => {
    const { POST } = await import('./[id]/rotate/route')
    return callRoute(POST, { method: 'POST', params: { id } })
  }

  it('replaces the secret and the prefix, keeps everything else, and makes the caller the creator', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000)
    const { id, secret, prefix } = await seedApiToken({ scopes: ['vms:read', 'vms:power'], connectionIds: ['c1'], expiresAt, rateLimitPerMin: 42 })
    const before = await prismaTest.apiToken.findUnique({ where: { id } })

    const res = await rotate(id)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.secret).toMatch(/^pxc_/)
    expect(body.data.secret).not.toBe(secret)
    expect(body.data.token.tokenPrefix).toBe(body.data.secret.slice(0, 12))
    expect(body.data.token.tokenHash).toBeUndefined()

    const after = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(after!.tokenPrefix).not.toBe(prefix)
    expect(after!.tokenHash).not.toBe(before!.tokenHash)
    expect(after).toMatchObject({
      name: before!.name, tenantId: 'default', scopes: ['vms:read', 'vms:power'], connectionIds: ['c1'],
      rateLimitPerMin: 42, createdByUserId: 'admin-1', createdByEmail: 'admin-1@test.local',
    })
    expect(after!.expiresAt?.getTime()).toBe(expiresAt.getTime())
    expect(JSON.stringify(after)).not.toContain(body.data.secret)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apitoken.rotate', resourceId: id, details: { previousPrefix: prefix, tokenPrefix: after!.tokenPrefix } }),
      expect.anything(),
    )
  })

  it('is refused without admin.apitokens, and without the licence option', async () => {
    const { id, prefix } = await seedApiToken()
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 403 }))
    expect((await rotate(id)).status).toBe(403)
    checkPermissionMock.mockResolvedValue(null)
    requireFeatureMock.mockResolvedValue(new Response(JSON.stringify({ error: 'licence' }), { status: 402 }))
    expect((await rotate(id)).status).toBe(402)
    expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
  })

  it('404 on an unknown token and on a token of another tenant for a non-admin', async () => {
    expect((await rotate('nope')).status).toBe(404)
    getRBACContextMock.mockResolvedValue({ userId: 'admin-1', isAdmin: false, tenantId: 'default' })
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 't2', slug: 't2', name: 'T2', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    const { id, prefix } = await seedApiToken({ tenantId: 't2' })
    expect((await rotate(id)).status).toBe(404)
    expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
  })

  it('refuses a legacy revoked token', async () => {
    const { id, prefix } = await seedApiToken({ revokedAt: new Date() })
    expect((await rotate(id)).status).toBe(409)
    expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
  })

  describe('anti-escalation', () => {
    const asUser = (userId: string | undefined = 'admin-1') => getRBACContextMock.mockResolvedValue({ userId, isAdmin: false, tenantId: 'default' })

    it('refuses a token carrying a scope the caller does not hold, naming it, and changes nothing', async () => {
      asUser()
      holdsMock.mockImplementation(async (_u, _t, key) => key === 'vm.view')
      const { id, prefix } = await seedApiToken({ scopes: ['vms:read', 'vms:power'] })
      const res = await rotate(id)
      expect(res.status).toBe(403)
      expect(await readJson<any>(res)).toEqual({ error: 'You cannot rotate a token carrying a scope you do not hold', scope: 'vms:power' })
      expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
      expect(auditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'apitoken.rotate' }), expect.anything())
    })

    it('checks the held rights against the tenant and the connections of the token', async () => {
      asUser()
      const { id } = await seedApiToken({ scopes: ['vms:power'], connectionIds: ['c9'] })
      expect((await rotate(id)).status).toBe(200)
      expect(holdsMock).toHaveBeenCalledWith('admin-1', 'default', expect.any(String), ['c9'])
    })

    it('a held-rights lookup that fails is a 503, and nothing changes', async () => {
      asUser()
      holdsMock.mockRejectedValue(new Error('db down: secret details'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { id, prefix } = await seedApiToken({ scopes: ['vms:power'] })
      const res = await rotate(id)
      expect(res.status).toBe(503)
      expect(await readJson<any>(res)).toEqual({ error: 'Unable to verify the scopes you can grant' })
      expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
      errSpy.mockRestore()
    })

    it('fails closed for a non-admin without a user id, but lets read-only scopes through with no creator', async () => {
      getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default' })
      const write = await seedApiToken({ scopes: ['vms:power'] })
      expect((await rotate(write.id)).status).toBe(403)
      const read = await seedApiToken({ scopes: ['vms:read'], createdByUserId: 'admin-1' })
      expect((await rotate(read.id)).status).toBe(200)
      expect((await prismaTest.apiToken.findUnique({ where: { id: read.id } }))!.createdByUserId).toBeNull()
    })
  })

  it('answers a generic 500 and keeps the old secret when the journal row cannot be written', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    auditMock.mockRejectedValue(new Error('audit store down at /srv/app'))
    const { id, prefix } = await seedApiToken()
    const res = await rotate(id)
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Internal server error' })
    expect((await prismaTest.apiToken.findUnique({ where: { id } }))!.tokenPrefix).toBe(prefix)
    errSpy.mockRestore()
  })
})
