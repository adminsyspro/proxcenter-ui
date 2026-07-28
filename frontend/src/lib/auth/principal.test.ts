import { describe, expect, it, vi, beforeEach } from 'vitest'

const { headersMock, getServerSessionMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import {
  ENTERPRISE_WITH_API_ACCESS,
  seedApiToken,
  seedDefaultTenant,
  tokenHeaders,
} from '@/__tests__/setup/apiTokens'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'
import { _resetRateLimitCounters } from '@/lib/api-tokens/rateLimit'
import { getPrincipal, getTokenPrincipalContext } from './principal'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  getServerSessionMock.mockResolvedValue(null)
  await truncate(['api_tokens', 'tenants'])
  await seedDefaultTenant()
})

function setHeaders(h: Headers) {
  headersMock.mockResolvedValue(h)
}

describe('getPrincipal, session fallback (step 2)', () => {
  it('returns ok without principal when there is no Bearer and no session', async () => {
    setHeaders(new Headers())
    const result = await getPrincipal()
    expect(result).toEqual({ ok: true })
  })

  it('returns a session principal from getServerSession', async () => {
    setHeaders(new Headers())
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', email: 'a@b.c', tenantId: 'tenant-x' },
    })
    const result = await getPrincipal()
    expect(result.ok).toBe(true)
    expect(result.principal).toEqual({
      kind: 'session', userId: 'user-1', userEmail: 'a@b.c', tenantId: 'tenant-x',
    })
  })
})

describe('getPrincipal, fail-closed internal headers (step 3)', () => {
  it('rejects 401 when a Bearer pxc_ arrives without x-pxc-* headers', async () => {
    const { secret } = await seedApiToken()
    setHeaders(new Headers({ authorization: `Bearer ${secret}` }))
    const result = await getPrincipal()
    expect(result.ok).toBe(false)
    expect(result.rejection?.status).toBe(401)
    expect(result.rejection?.body).toEqual({ error: 'Invalid or expired API token' })
    expect(result.rejection?.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="proxcenter"' })
    expect(getServerSessionMock).not.toHaveBeenCalled()
  })

  it('rejects 401 on an unknown x-pxc-entry', async () => {
    const { secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'not-an-entry', '/api/v1/vms'))
    const result = await getPrincipal()
    expect(result.ok).toBe(false)
    expect(result.rejection?.status).toBe(401)
  })

  it('rejects 401 when x-pxc-path disagrees with the designated entry (step 10)', async () => {
    const { secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/storage'))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(401)
  })
})

describe('getPrincipal, read-only (step 4, D1)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('rejects %s with 405 before any scope logic', async (method) => {
    const { secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms', method))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(405)
    expect(result.rejection?.body).toEqual({ error: 'API tokens are read-only', method })
    expect(result.rejection?.headers).toEqual({ Allow: 'GET, HEAD' })
  })

  it('write methods get 405, not 403, even when the token is also out of scope (precedence)', async () => {
    const { secret } = await seedApiToken({ scopes: ['storage:read'] })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms', 'POST'))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(405)
  })

  it('accepts HEAD', async () => {
    const { secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms', 'HEAD'))
    expect((await getPrincipal()).ok).toBe(true)
  })
})

describe('getPrincipal, token validation (steps 5-7)', () => {
  it('resolves a valid token into a token principal with expanded scopes', async () => {
    const { id, secret } = await seedApiToken({ scopes: ['vms:read', 'nodes:read'], connectionIds: ['conn-a'] })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const result = await getPrincipal()
    expect(result.ok).toBe(true)
    expect(result.principal?.kind).toBe('token')
    expect(result.principal?.tokenId).toBe(id)
    expect(result.principal?.tenantId).toBe('default')
    expect(result.principal?.permissions).toEqual(new Set(['vm.view', 'node.view', 'connection.view']))
    expect(result.principal?.scopes).toEqual(['vms:read', 'nodes:read'])
    expect(result.principal?.connectionIds).toEqual(['conn-a'])
  })

  it('rejects 401 on unknown prefix, wrong hash, revoked and expired (same body, no oracle)', async () => {
    const { secret } = await seedApiToken()
    const wrong = secret.slice(0, -2) + 'zz'
    // 'pxc_x' is too short to even carry a prefix (extractTokenPrefix null).
    for (const bad of [`pxc_${'Q'.repeat(43)}`, wrong, 'pxc_x']) {
      setHeaders(tokenHeaders(bad, 'vms-list', '/api/v1/vms'))
      const r = await getPrincipal()
      expect(r.rejection?.status).toBe(401)
      expect(r.rejection?.body).toEqual({ error: 'Invalid or expired API token' })
    }
    const revoked = await seedApiToken({ revokedAt: new Date() })
    setHeaders(tokenHeaders(revoked.secret, 'vms-list', '/api/v1/vms'))
    expect((await getPrincipal()).rejection?.status).toBe(401)
    const expired = await seedApiToken({ expiresAt: new Date(Date.now() - 1000) })
    setHeaders(tokenHeaders(expired.secret, 'vms-list', '/api/v1/vms'))
    expect((await getPrincipal()).rejection?.status).toBe(401)
  })

  it('rejects 403 when the token tenant is disabled, never a fallback to default', async () => {
    const now = new Date()
    await prismaTest.tenant.create({
      // operatingModel: non-default tenants must carry one (CHECK
      // tenant_default_has_no_model, msp_alpha1_schema migration).
      data: { id: 'dead', slug: 'dead', name: 'Dead', enabled: false, operatingModel: 'iaas', createdAt: now, updatedAt: now },
    })
    const { secret } = await seedApiToken({ tenantId: 'dead' })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(403)
    expect(result.rejection?.body).toEqual({ error: 'API token tenant is disabled or missing' })
  })
})

describe('getPrincipal, license (step 8, D6)', () => {
  it('rejects 403 unlicensed when the option is absent (fail-closed)', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({
      ...ENTERPRISE_WITH_API_ACCESS, options: [],
    })
    _resetLicenseVerdictCache()
    const { secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(403)
    expect(result.rejection?.body).toEqual({ error: 'Feature not licensed', feature: 'api_access' })
  })
})

describe('getPrincipal, quota and scopes (steps 9-10)', () => {
  it('counts quota only with recordUsage and returns 429 with headers on overflow', async () => {
    const { secret } = await seedApiToken({ rateLimitPerMin: 2 })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    expect((await getPrincipal({ recordUsage: true })).rateLimit?.remaining).toBe(1)
    expect((await getPrincipal({ recordUsage: true })).rateLimit?.remaining).toBe(0)
    const denied = await getPrincipal({ recordUsage: true })
    expect(denied.rejection?.status).toBe(429)
    expect(denied.rejection?.body).toEqual({
      error: 'Rate limit exceeded',
      retryAfter: (denied.rejection?.body as any).retryAfter,
    })
    expect(denied.rejection?.headers?.['Retry-After']).toBeDefined()
    expect(denied.rejection?.headers?.['RateLimit-Remaining']).toBe('0')
    // Identity calls (no recordUsage) never consume quota:
    expect((await getPrincipal()).ok).toBe(true)
  })

  it('quota is consumed by every authenticated call BEFORE the scope check', async () => {
    const { secret } = await seedApiToken({ scopes: ['storage:read'], rateLimitPerMin: 1 })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const first = await getPrincipal({ recordUsage: true })
    expect(first.rejection?.status).toBe(403) // out-of-scope, but quota spent
    const second = await getPrincipal({ recordUsage: true })
    expect(second.rejection?.status).toBe(429)
  })

  it('rejects 403 out-of-scope with the spec body when no requiredScope is held', async () => {
    const { secret } = await seedApiToken({ scopes: ['storage:read'] })
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const result = await getPrincipal()
    expect(result.rejection?.status).toBe(403)
    expect(result.rejection?.body).toEqual({
      error: 'Route not available to API tokens',
      route: '/api/v1/vms',
    })
  })

  it('anyOf: a token holding only ONE of several acceptable scopes is admitted', async () => {
    // public-metrics lists nodes:read, vms:read AND backups:read; holding a
    // single one must yield a (filtered) 200 downstream, never a 403.
    const { secret } = await seedApiToken({ scopes: ['vms:read'] })
    setHeaders(tokenHeaders(secret, 'public-metrics', '/api/v1/public/metrics'))
    const result = await getPrincipal()
    expect(result.ok).toBe(true)
    expect(result.principal?.kind).toBe('token')
  })

  it('empty requiredScopes (health) admits any valid token', async () => {
    const { secret } = await seedApiToken({ scopes: ['storage:read'] })
    setHeaders(tokenHeaders(secret, 'public-health', '/api/v1/public/health'))
    expect((await getPrincipal()).ok).toBe(true)
  })
})

describe('getPrincipal, last_used (step 11, D5)', () => {
  it('touches last_used_at/ip only with recordUsage', async () => {
    const { id, secret } = await seedApiToken()
    const h = tokenHeaders(secret, 'vms-list', '/api/v1/vms')
    h.set('x-forwarded-for', '203.0.113.9')
    setHeaders(h)
    await getPrincipal()
    expect((await prismaTest.apiToken.findUnique({ where: { id } }))?.lastUsedAt).toBeNull()
    await getPrincipal({ recordUsage: true })
    const row = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(row?.lastUsedAt).not.toBeNull()
    expect(row?.lastUsedIp).toBe('203.0.113.9')
  })
})

describe('getTokenPrincipalContext', () => {
  it('is inert without a Bearer', async () => {
    setHeaders(new Headers())
    expect(await getTokenPrincipalContext()).toEqual({ rejected: false })
  })

  it('rejects (never a session fallback) on an invalid Bearer', async () => {
    setHeaders(new Headers({ authorization: 'Bearer pxc_definitely-not-a-token' }))
    const ctx = await getTokenPrincipalContext()
    expect(ctx.rejected).toBe(true)
    expect(ctx.rejection?.status).toBe(401)
  })

  it('exposes the token principal on a valid call', async () => {
    const { id, secret } = await seedApiToken()
    setHeaders(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const ctx = await getTokenPrincipalContext()
    expect(ctx.rejected).toBe(false)
    expect(ctx.principal?.tokenId).toBe(id)
  })
})
