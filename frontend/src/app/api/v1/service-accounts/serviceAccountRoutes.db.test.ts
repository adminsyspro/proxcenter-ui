/**
 * /api/v1/service-accounts (issue #1404): real routes, real public-API guard,
 * real RBAC and real tokens over the test database. Only the session, the
 * request headers the proxy would set and the license are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { headersMock, sessionMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  sessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { ENTERPRISE_WITH_API_ACCESS, seedApiToken, seedDefaultTenant, tokenHeaders } from '@/__tests__/setup/apiTokens'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'
import { _resetRateLimitCounters } from '@/lib/api-tokens/rateLimit'
import { _resetCreatorCheckCache } from '@/lib/api-tokens/creatorCheck'
import { getPrincipal } from '@/lib/auth/principal'

import * as list from './route'
import * as one from './[id]/route'
import * as tokens from './[id]/tokens/route'
import * as token from './[id]/tokens/[tokenId]/route'
import * as rotate from './[id]/tokens/[tokenId]/rotate/route'

const now = new Date()
const PERMS = [
  'admin.apitokens', 'admin.apitokens.view', 'admin.settings', 'admin.settings.view', 'admin.settings.identity',
  'vm.view', 'node.view', 'connection.view', 'node.network', 'connection.manage',
  'sdn.vnet.view', 'sdn.vnet.create', 'sdn.vnet.edit', 'sdn.vnet.delete',
]

async function role(id: string, permissions: string[]) {
  await prismaTest.rbacRole.create({
    data: { id, name: id, createdAt: now, updatedAt: now, permissions: { create: permissions.map(permissionId => ({ permissionId })) } },
  })
}

async function user(id: string, tenantId = 'default') {
  await prismaTest.user.create({ data: { id, email: `${id}@example.com`, tenantId, createdAt: now, updatedAt: now } })
  await prismaTest.userTenant.create({ data: { userId: id, tenantId, isDefault: true, joinedAt: now } })
}

async function member(userId: string, tenantId: string) {
  await prismaTest.userTenant.create({ data: { userId, tenantId, isDefault: false, joinedAt: now } })
}

let grantSeq = 0
async function grant(userId: string, roleId: string, tenantId: string) {
  await prismaTest.rbacUserRole.create({
    data: { id: `g${++grantSeq}`, userId, roleId, scopeType: 'global', tenantId, grantedAt: now },
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  _resetCreatorCheckCache()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  await truncate(['audit_logs', 'api_tokens', 'rbac_user_roles', 'rbac_role_permissions', 'user_tenants', 'users', 'tenants'])
  await prismaTest.rbacRole.deleteMany({})
  for (const id of PERMS) {
    await prismaTest.rbacPermission.upsert({ where: { id }, update: {}, create: { id, name: id, category: id.split('.')[0] } })
  }
  await seedDefaultTenant()
  for (const id of ['acme', 'beta']) {
    await prismaTest.tenant.create({ data: { id, slug: id, name: id.toUpperCase(), operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  }
  await role('role_super_admin', [])
  await role('r_tokens', ['admin.apitokens'])
  await role('r_identity', ['admin.apitokens', 'admin.settings'])
  await role('r_vm', ['vm.view'])
  await role('r_net', ['node.view', 'connection.view', 'node.network', 'connection.manage', 'sdn.vnet.view', 'sdn.vnet.create', 'sdn.vnet.edit', 'sdn.vnet.delete'])
  await user('admin')
  await grant('admin', 'role_super_admin', 'default')
  await user('op')
  await grant('op', 'r_tokens', 'default')
  asSession('admin')
})

function asSession(id: string, tenantId = 'default') {
  headersMock.mockResolvedValue(new Headers())
  sessionMock.mockResolvedValue({ user: { id, email: `${id}@example.com`, tenantId } })
}

/** The request as the proxy forwards a Bearer call to `entryId`. */
function asToken(secret: string, entryId: string, path: string, method: string) {
  headersMock.mockResolvedValue(tokenHeaders(secret, entryId, path, method))
}

const req = (method: string, body?: unknown) =>
  new Request('http://t/api/v1/service-accounts', { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })
const p = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

async function createAccount(tenantId: string, name = 'ci') {
  const res = await json(await list.POST(req('POST', { name, tenantId }), {} as any))
  expect(res.status).toBe(201)
  return res.body.data as { id: string; tenantId: string }
}

describe('provider session', () => {
  it('creates, lists, reads, renames, disables and deletes a service account of a customer tenant', async () => {
    const sa = await createAccount('acme', 'ci-onboarding')
    expect(sa.tenantId).toBe('acme')

    expect((await json(await list.GET(req('GET'), {} as any))).body.data.map((s: any) => s.id)).toEqual([sa.id])
    expect((await json(await one.GET(req('GET'), p({ id: sa.id })))).body.data).toMatchObject({ name: 'ci-onboarding', enabled: true })

    const patched = await json(await one.PATCH(req('PATCH', { name: 'ci-2', enabled: false }), p({ id: sa.id })))
    expect(patched.body.data).toMatchObject({ name: 'ci-2', enabled: false })

    expect((await json(await one.DELETE(req('DELETE'), p({ id: sa.id })))).body).toEqual({ data: { id: sa.id, deleted: true } })
    expect(await prismaTest.user.findUnique({ where: { id: sa.id } })).toBeNull()
  })

  it('answers 404 for an unknown account or a human user, 400 for a bad body', async () => {
    expect((await one.GET(req('GET'), p({ id: 'op' }))).status).toBe(404)
    expect((await one.PATCH(req('PATCH', { name: 'x' }), p({ id: 'nope' }))).status).toBe(404)
    expect((await list.POST(req('POST', { name: '', tenantId: 'acme' }), {} as any)).status).toBe(400)
  })

  it('refuses a caller without admin.apitokens', async () => {
    await user('viewer')
    asSession('viewer')
    expect((await list.GET(req('GET'), {} as any)).status).toBe(403)
    expect((await list.POST(req('POST', { name: 'x', tenantId: 'acme' }), {} as any)).status).toBe(403)
  })

  it('mints a token that takes the roles of the account, only for scopes the account holds', async () => {
    const sa = await createAccount('acme')
    const ask = (scopes: string[]) => tokens.POST(req('POST', { name: 'tf', scopes }), p({ id: sa.id }))

    const refused = await json(await ask(['vms:read']))
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ scope: 'vms:read' })

    await grant(sa.id, 'r_vm', 'acme')
    const minted = await json(await ask(['vms:read']))
    expect(minted.status).toBe(201)
    expect(minted.body.data.secret).toMatch(/^pxc_/)
    const row = await prismaTest.apiToken.findUnique({ where: { id: minted.body.data.token.id } })
    expect(row).toMatchObject({ tenantId: 'acme', serviceAccountId: sa.id, createdByUserId: 'admin' })

    asToken(minted.body.data.secret, 'vms-list', '/api/v1/vms', 'GET')
    expect((await getPrincipal()).principal).toMatchObject({ serviceAccountId: sa.id, creatorUserId: sa.id, tenantId: 'acme' })

    asSession('admin')
    expect((await json(await tokens.GET(req('GET'), p({ id: sa.id })))).body.data.map((t: any) => t.id)).toEqual([row!.id])
  })

  it('keeps the anti-escalation of the person minting: a scope they do not hold is refused', async () => {
    const sa = await createAccount('acme')
    await grant(sa.id, 'r_net', 'acme')
    await member('op', 'acme')
    asSession('op')
    const res = await json(await tokens.POST(req('POST', { name: 'tf', scopes: ['network:write'] }), p({ id: sa.id })))
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ scope: 'network:write' })
  })

  it('never hands a provider user who is not a member of the account tenant a secret, even read-only', async () => {
    const sa = await createAccount('acme')
    await grant(sa.id, 'r_vm', 'acme')
    const existing = await seedApiToken({ tenantId: 'acme', scopes: ['vms:read'], serviceAccountId: sa.id })
    asSession('op')
    const minted = await json(await tokens.POST(req('POST', { name: 'tf', scopes: ['vms:read'] }), p({ id: sa.id })))
    expect(minted.status).toBe(403)
    expect(minted.body).toEqual({ error: 'Tenant not accessible' })
    const rotated = await json(await rotate.POST(req('POST'), p({ id: sa.id, tokenId: existing.id })))
    expect(rotated.status).toBe(403)
    expect((await prismaTest.apiToken.findUnique({ where: { id: existing.id } }))!.tokenPrefix).toBe(existing.prefix)

    await member('op', 'acme')
    expect((await tokens.POST(req('POST', { name: 'tf', scopes: ['vms:read'] }), p({ id: sa.id }))).status).toBe(201)
  })

  it('refuses a token for a disabled account, and deletes one token of the account only', async () => {
    const sa = await createAccount('acme')
    const other = await createAccount('acme', 'other')
    await grant(sa.id, 'r_vm', 'acme')
    const own = await seedApiToken({ tenantId: 'acme', serviceAccountId: sa.id })
    const foreign = await seedApiToken({ tenantId: 'acme', serviceAccountId: other.id })

    expect((await token.DELETE(req('DELETE'), p({ id: sa.id, tokenId: foreign.id }))).status).toBe(404)
    expect((await json(await token.DELETE(req('DELETE'), p({ id: sa.id, tokenId: own.id })))).body).toEqual({ data: { id: own.id, deleted: true } })
    expect(await prismaTest.apiToken.findUnique({ where: { id: foreign.id } })).not.toBeNull()

    await prismaTest.user.update({ where: { id: sa.id }, data: { enabled: false } })
    expect((await tokens.POST(req('POST', { name: 'tf', scopes: ['vms:read'] }), p({ id: sa.id }))).status).toBe(409)
  })
})

describe('API token', () => {
  it('a provider token with identity:write onboards a service account and its token, never wider than itself', async () => {
    const { secret } = await seedApiToken({ scopes: ['identity:write', 'vms:read'], createdByUserId: 'admin' })

    asToken(secret, 'service-account-create', '/api/v1/service-accounts', 'POST')
    const created = await json(await list.POST(req('POST', { name: 'tenant-ci', tenantId: 'acme' }), {} as any))
    expect(created.status).toBe(201)
    const sa = created.body.data
    await grant(sa.id, 'r_net', 'acme')
    await grant(sa.id, 'r_vm', 'acme')

    const path = `/api/v1/service-accounts/${sa.id}/tokens`
    asToken(secret, 'service-account-token-create', path, 'POST')
    const wider = await json(await tokens.POST(req('POST', { name: 'x', scopes: ['network:write'] }), p({ id: sa.id })))
    expect(wider.status).toBe(403)
    expect(wider.body).toEqual({ error: 'An API token cannot grant a scope it does not carry', scope: 'network:write' })

    const minted = await json(await tokens.POST(req('POST', { name: 'x', scopes: ['vms:read'] }), p({ id: sa.id })))
    expect(minted.status).toBe(201)
    expect(await prismaTest.apiToken.findUnique({ where: { id: minted.body.data.token.id } }))
      .toMatchObject({ serviceAccountId: sa.id, createdByUserId: 'admin' })
  })

  it('a token without an identity scope cannot reach the routes', async () => {
    const { secret } = await seedApiToken({ scopes: ['vms:read'], createdByUserId: 'admin' })
    asToken(secret, 'service-accounts-list', '/api/v1/service-accounts', 'GET')
    expect((await list.GET(req('GET'), {} as any)).status).toBe(403)
  })

  it('a customer tenant token sees and creates in its own tenant only', async () => {
    await createAccount('beta', 'beta-ci')
    await prismaTest.tenant.update({ where: { id: 'acme' }, data: { apiSelfService: true } })
    const { secret } = await seedApiToken({ tenantId: 'acme', scopes: ['identity:write'], createdByUserId: 'admin' })

    asToken(secret, 'service-account-create', '/api/v1/service-accounts', 'POST')
    expect((await list.POST(req('POST', { name: 'x', tenantId: 'beta' }), {} as any)).status).toBe(404)
    const mine = await json(await list.POST(req('POST', { name: 'acme-ci' }), {} as any))
    expect(mine.body.data.tenantId).toBe('acme')

    asToken(secret, 'service-accounts-list', '/api/v1/service-accounts', 'GET')
    expect((await json(await list.GET(req('GET'), {} as any))).body.data.map((s: any) => s.name)).toEqual(['acme-ci'])
  })

  it('a service account token rotates its own tokens but never changes or deletes its own account', async () => {
    const sa = await createAccount('default', 'automation')
    await grant(sa.id, 'r_identity', 'default')
    const { secret } = await seedApiToken({ scopes: ['identity:write'], createdByUserId: 'admin', serviceAccountId: sa.id })

    const self = `/api/v1/service-accounts/${sa.id}`
    asToken(secret, 'service-account-update', self, 'PATCH')
    expect((await one.PATCH(req('PATCH', { enabled: false }), p({ id: sa.id }))).status).toBe(403)
    asToken(secret, 'service-account-delete', self, 'DELETE')
    expect((await one.DELETE(req('DELETE'), p({ id: sa.id }))).status).toBe(403)

    asToken(secret, 'service-account-token-create', `${self}/tokens`, 'POST')
    const rotated = await json(await tokens.POST(req('POST', { name: 'next', scopes: ['identity:write'] }), p({ id: sa.id })))
    expect(rotated.status).toBe(201)
    expect(await prismaTest.apiToken.findUnique({ where: { id: rotated.body.data.token.id } })).toMatchObject({ createdByUserId: sa.id })
  })
})

describe('rotating a token of a service account (#1404)', () => {
  const rotateIt = (id: string, tokenId: string) => rotate.POST(req('POST'), p({ id, tokenId }))

  it('changes only the secret: same token, scopes and account, the old secret stops at once, audited', async () => {
    const sa = await createAccount('acme')
    await grant(sa.id, 'r_vm', 'acme')
    const old = await seedApiToken({ tenantId: 'acme', scopes: ['vms:read'], serviceAccountId: sa.id, createdByUserId: 'op' })

    const res = await json(await rotateIt(sa.id, old.id))
    expect(res.status).toBe(200)
    expect(res.body.data.secret).toMatch(/^pxc_/)
    expect(res.body.data.token).toMatchObject({ id: old.id, serviceAccountId: sa.id })
    const row = await prismaTest.apiToken.findUnique({ where: { id: old.id } })
    expect(row).toMatchObject({ scopes: ['vms:read'], serviceAccountId: sa.id, tenantId: 'acme', createdByUserId: 'admin' })
    expect(row!.tokenPrefix).not.toBe(old.prefix)

    asToken(old.secret, 'vms-list', '/api/v1/vms', 'GET')
    expect((await getPrincipal()).ok).toBe(false)
    asToken(res.body.data.secret, 'vms-list', '/api/v1/vms', 'GET')
    expect((await getPrincipal()).principal).toMatchObject({ serviceAccountId: sa.id, creatorUserId: sa.id })

    const entry = await prismaTest.auditLog.findFirst({ where: { action: 'apitoken.rotate', resourceId: old.id } })
    const details = typeof entry!.details === 'string' ? JSON.parse(entry!.details) : entry!.details
    expect(details).toMatchObject({ previousPrefix: old.prefix, tokenPrefix: row!.tokenPrefix })
  })

  it('answers 404 for a token of another account, 409 for a disabled account', async () => {
    const sa = await createAccount('acme')
    const other = await createAccount('acme', 'other')
    await grant(sa.id, 'r_vm', 'acme')
    const foreign = await seedApiToken({ tenantId: 'acme', serviceAccountId: other.id })
    const own = await seedApiToken({ tenantId: 'acme', serviceAccountId: sa.id })

    expect((await rotateIt(sa.id, foreign.id)).status).toBe(404)
    await prismaTest.user.update({ where: { id: sa.id }, data: { enabled: false } })
    expect((await rotateIt(sa.id, own.id)).status).toBe(409)
  })

  it('holds the rotator to the same rules as minting: they hold the scopes, and so does the account', async () => {
    const sa = await createAccount('acme')
    await grant(sa.id, 'r_net', 'acme')
    const net = await seedApiToken({ tenantId: 'acme', scopes: ['network:write'], serviceAccountId: sa.id })
    await member('op', 'acme')
    asSession('op')
    const escalation = await json(await rotateIt(sa.id, net.id))
    expect(escalation.status).toBe(403)
    expect(escalation.body).toMatchObject({ scope: 'network:write' })

    asSession('admin')
    const unheld = await seedApiToken({ tenantId: 'acme', scopes: ['vms:read'], serviceAccountId: sa.id })
    const res = await json(await rotateIt(sa.id, unheld.id))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ scope: 'vms:read' })
    expect((await prismaTest.apiToken.findUnique({ where: { id: unheld.id } }))!.tokenPrefix).toBe(unheld.prefix)
  })

  it('lets an account token rotate itself, never a token wider than itself', async () => {
    const sa = await createAccount('default', 'automation')
    await grant(sa.id, 'r_identity', 'default')
    await grant(sa.id, 'r_vm', 'default')
    const self = await seedApiToken({ scopes: ['identity:write'], serviceAccountId: sa.id, createdByUserId: 'admin' })
    const wider = await seedApiToken({ scopes: ['vms:read'], serviceAccountId: sa.id, createdByUserId: 'admin' })

    const path = (id: string) => `/api/v1/service-accounts/${sa.id}/tokens/${id}/rotate`
    asToken(self.secret, 'service-account-token-rotate', path(wider.id), 'POST')
    const refused = await json(await rotateIt(sa.id, wider.id))
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ scope: 'vms:read' })

    asToken(self.secret, 'service-account-token-rotate', path(self.id), 'POST')
    const res = await json(await rotateIt(sa.id, self.id))
    expect(res.status).toBe(200)
    expect(await prismaTest.apiToken.findUnique({ where: { id: self.id } })).toMatchObject({ createdByUserId: sa.id })
  })
})

describe('the OIDC connection of a customer tenant through a token', () => {
  it('a provider identity:read token reads it, a customer tenant token is refused', async () => {
    const oidc = await import('@/app/api/v1/auth/oidc/connections/[tenantId]/route')
    const path = '/api/v1/auth/oidc/connections/acme'
    const provider = await seedApiToken({ scopes: ['identity:read'], createdByUserId: 'admin' })
    asToken(provider.secret, 'tenant-oidc-connection-get', path, 'GET')
    const read = await json(await oidc.GET(new Request(`http://t${path}`), p({ tenantId: 'acme' })))
    expect(read.status).toBe(200)
    expect(read.body.data).toMatchObject({ tenant_id: 'acme', configured: false, hasClientSecret: false })

    const customer = await seedApiToken({ tenantId: 'acme', scopes: ['identity:read'], createdByUserId: 'admin' })
    asToken(customer.secret, 'tenant-oidc-connection-get', path, 'GET')
    expect((await oidc.GET(new Request(`http://t${path}`), p({ tenantId: 'acme' }))).status).toBe(403)
  })

  it('an identity:write token configures it but can never trust its endpoints', async () => {
    const oidc = await import('@/app/api/v1/auth/oidc/connections/[tenantId]/route')
    const path = '/api/v1/auth/oidc/connections/acme'
    const { secret } = await seedApiToken({ scopes: ['identity:write'], createdByUserId: 'admin' })
    asToken(secret, 'tenant-oidc-connection-update', path, 'PUT')
    const put = (body: unknown) => oidc.PUT(new Request(`http://t${path}`, { method: 'PUT', body: JSON.stringify(body) }), p({ tenantId: 'acme' }))
    const res = await put({ enabled: false, issuer_url: 'https://93.184.216.34/realms/acme', client_id: 'pxc', trusted_endpoints: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "An API token cannot trust a tenant's endpoints" })
    expect(await prismaTest.oidcConfig.count()).toBe(0)

    await role('role_tenant_viewer', [])
    const saved = await put({ enabled: false, issuer_url: 'https://93.184.216.34/realms/acme', client_id: 'pxc', client_secret: 's3cret' })
    expect(saved.status).toBe(200)
    expect(await prismaTest.oidcConfig.findFirst({ where: { tenantId: 'acme' } })).toMatchObject({ clientId: 'pxc', trustedEndpoints: false })
  })
})

describe('a customer tenant manages its own service accounts once the provider opens it (#1404)', () => {
  beforeEach(async () => {
    await role('role_tenant_admin', ['admin.apitokens', 'admin.settings', 'vm.view'])
    await user('acme-admin', 'acme')
    await grant('acme-admin', 'role_tenant_admin', 'acme')
    asSession('acme-admin', 'acme')
  })

  it('is refused while the provider keeps it closed, session and token alike', async () => {
    const res = await json(await list.GET(req('GET'), {} as any))
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: "The provider manages this tenant's service accounts and API tokens" })

    const { secret } = await seedApiToken({ tenantId: 'acme', scopes: ['identity:write'], createdByUserId: 'admin' })
    asToken(secret, 'service-accounts-list', '/api/v1/service-accounts', 'GET')
    expect((await list.GET(req('GET'), {} as any)).status).toBe(403)
  })

  it('creates an account in its tenant only, and mints within its own rights, never a provider scope', async () => {
    await prismaTest.tenant.update({ where: { id: 'acme' }, data: { apiSelfService: true } })
    await createAccount('beta', 'beta-ci').catch(() => null)
    const mine = await json(await list.POST(req('POST', { name: 'acme-ci' }), {} as any))
    expect(mine.body.data.tenantId).toBe('acme')
    expect((await list.POST(req('POST', { name: 'x', tenantId: 'beta' }), {} as any)).status).toBe(404)
    await grant(mine.body.data.id, 'role_tenant_admin', 'acme')

    const provider = await json(await tokens.POST(req('POST', { name: 'x', scopes: ['vdcs:write'] }), p({ id: mine.body.data.id })))
    expect(provider.status).toBe(400)
    expect(provider.body).toMatchObject({ scope: 'vdcs:write' })

    const ok = await json(await tokens.POST(req('POST', { name: 'x', scopes: ['vms:read'] }), p({ id: mine.body.data.id })))
    expect(ok.status).toBe(201)
  })
})
