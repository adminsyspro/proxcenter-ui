import { describe, expect, it, vi, beforeEach } from 'vitest'

const { headersMock, getServerSessionMock, resolveVisibleMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
  resolveVisibleMock: vi.fn<() => Promise<Set<string>>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('./scope', () => ({ resolveVisibleConnectionIds: resolveVisibleMock }))

import { NextResponse } from 'next/server'

import { truncate } from '@/__tests__/setup/prisma-test'
import {
  ENTERPRISE_WITH_API_ACCESS,
  seedApiToken,
  seedDefaultTenant,
  tokenHeaders,
} from '@/__tests__/setup/apiTokens'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'
import { _resetRateLimitCounters } from '@/lib/api-tokens/rateLimit'
import { withPublicApiGuard } from './routeGuard'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  getServerSessionMock.mockResolvedValue(null)
  resolveVisibleMock.mockResolvedValue(new Set(['conn-a']))
  await truncate(['api_tokens', 'tenants'])
  await seedDefaultTenant()
})

const okHandler = vi.fn(async () => NextResponse.json({ data: 'ok' }))

describe('withPublicApiGuard', () => {
  it('maps a rejection to the exact HTTP response', async () => {
    headersMock.mockResolvedValue(new Headers({ authorization: 'Bearer pxc_bogus-bogus' }))
    const guarded = withPublicApiGuard('vms-list', okHandler)
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid or expired API token' })
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="proxcenter"')
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('never reaches the handler when the license verdict denies', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({
      ...ENTERPRISE_WITH_API_ACCESS, options: [],
    })
    _resetLicenseVerdictCache()
    const { secret } = await seedApiToken()
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const guarded = withPublicApiGuard('vms-list', okHandler)
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Feature not licensed', feature: 'api_access' })
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('fails closed (401, no handler) when the guard entry id is not in the allowlist', async () => {
    // A token principal resolved against 'vms-list' must never reach a
    // handler whose guard was registered under an unknown entry id.
    const { secret } = await seedApiToken()
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const guarded = withPublicApiGuard('not-an-entry', okHandler)
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(401)
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('fails closed (401, no handler) when the forwarded path does not carry the declared connection segment', async () => {
    // Edge matched 'vms-list' but the handler is guarded as 'pbs-backups':
    // the connection segment cannot be extracted, so nothing is served.
    const { secret } = await seedApiToken({ scopes: ['vms:read'] })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const guarded = withPublicApiGuard('pbs-backups', okHandler)
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(401)
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('passes the token principal to the handler and sets RateLimit-* headers', async () => {
    const { id, secret } = await seedApiToken({ rateLimitPerMin: 600 })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const guarded = withPublicApiGuard('vms-list', async (req, ctx) => {
      expect(ctx.principal?.tokenId).toBe(id)
      return NextResponse.json({ data: 'ok' })
    })
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(200)
    expect(res.headers.get('RateLimit-Limit')).toBe('600')
    expect(res.headers.get('RateLimit-Remaining')).toBe('599')
    // RateLimit-Reset is DELAY-SECONDS until the window reopens (never a Unix
    // timestamp): always within the 60s fixed window.
    const reset = Number(res.headers.get('RateLimit-Reset'))
    expect(reset).toBeGreaterThan(0)
    expect(reset).toBeLessThanOrEqual(60)
  })

  it('layer 1: rejects 403 when the declared connection segment is out of perimeter, BEFORE the handler', async () => {
    const { secret } = await seedApiToken({ scopes: ['backups:read'], connectionIds: ['conn-a'] })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'pbs-backups', '/api/v1/pbs/conn-B/backups'))
    const guarded = withPublicApiGuard('pbs-backups', okHandler)
    const res = await guarded(new Request('http://t/_'), { params: Promise.resolve({ id: 'conn-B' }) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-B' })
    expect(okHandler).not.toHaveBeenCalled()
  })

  it('layer 1: admits an in-perimeter connection segment', async () => {
    const { secret } = await seedApiToken({ scopes: ['backups:read'], connectionIds: ['conn-a'] })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'pbs-backups', '/api/v1/pbs/conn-a/backups'))
    const guarded = withPublicApiGuard('pbs-backups', okHandler)
    const res = await guarded(new Request('http://t/_'), { params: Promise.resolve({ id: 'conn-a' }) })
    expect(res.status).toBe(200)
  })

  it('session callers pass through unchanged, no RateLimit headers', async () => {
    headersMock.mockResolvedValue(new Headers())
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    const guarded = withPublicApiGuard('vms-list', okHandler)
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(200)
    expect(res.headers.get('RateLimit-Limit')).toBeNull()
  })
})
