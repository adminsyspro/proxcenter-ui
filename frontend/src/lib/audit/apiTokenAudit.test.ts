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
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { invalidateTrustedProxiesCache } from '@/lib/net/clientIp'
import { audit } from './index'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  headersMock.mockResolvedValue(new Headers())
  getServerSessionMock.mockResolvedValue(null)
  invalidateTrustedProxiesCache()
  await truncate(['audit_logs', 'api_tokens', 'tenants', 'security_policies'])
  await seedDefaultTenant()
})

describe('audit, client IP', () => {
  it('records the hop the trusted proxy appended, not a forged first hop', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))
    const row = await prismaTest.auditLog.findUnique({ where: { id: await audit({ action: 'login', category: 'auth' }) } })
    expect(row?.ipAddress).toBe('203.0.113.9')
  })

  it('follows the trusted proxies setting', async () => {
    await prismaTest.securityPolicy.create({
      data: { id: 'default', tenantId: 'default', loginTrustedProxies: 2, updatedAt: new Date() },
    })
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' }))
    const row = await prismaTest.auditLog.findUnique({ where: { id: await audit({ action: 'login', category: 'auth' }) } })
    expect(row?.ipAddress).toBe('203.0.113.9')
  })

  it('records null when the IP cannot be resolved, and ignores x-real-ip', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-real-ip': '6.6.6.6' }))
    const row = await prismaTest.auditLog.findUnique({ where: { id: await audit({ action: 'login', category: 'auth' }) } })
    expect(row?.ipAddress).toBeNull()
  })
})

describe('audit, token attribution (D13)', () => {
  it('attributes a token call to apiTokenId and leaves user fields null', async () => {
    const { id, secret } = await seedApiToken()
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const auditId = await audit({ action: 'read', category: 'api_tokens' })
    const row = await prismaTest.auditLog.findUnique({ where: { id: auditId } })
    expect(row?.apiTokenId).toBe(id)
    expect(row?.userId).toBeNull()
    expect(row?.userEmail).toBeNull()
    expect(row?.tenantId).toBe('default')
  })

  it('keeps the session behavior unchanged (user fields, no apiTokenId)', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@x.io', tenantId: 'default' } })
    const auditId = await audit({ action: 'login', category: 'auth' })
    const row = await prismaTest.auditLog.findUnique({ where: { id: auditId } })
    expect(row?.userId).toBe('u1')
    expect(row?.userEmail).toBe('u1@x.io')
    expect(row?.apiTokenId).toBeNull()
  })

  it('accepts an explicit entry.apiTokenId without any header lookup', async () => {
    const auditId = await audit({ action: 'apitoken.delete', category: 'api_tokens', apiTokenId: 'tok_explicit' })
    const row = await prismaTest.auditLog.findUnique({ where: { id: auditId } })
    expect(row?.apiTokenId).toBe('tok_explicit')
  })

  it('audit/index.ts no longer references getServerSession', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/lib/audit/index.ts', 'utf8').includes('getServerSession')).toBe(false)
  })
})

describe('withPublicApiGuard logs apitoken.denied on rejection', () => {
  it('writes a failure audit row with the token prefix only, never the secret', async () => {
    const secret = 'pxc_' + 'Z'.repeat(43)
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const guarded = withPublicApiGuard('vms-list', async () => new Response('never'))
    const res = await guarded(new Request('http://t/_'), {})
    expect(res.status).toBe(401)
    const rows = await prismaTest.auditLog.findMany({ where: { action: 'apitoken.denied' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failure')
    expect(rows[0].category).toBe('api_tokens')
    const details = rows[0].details as any
    expect(details.status).toBe(401)
    expect(details.tokenPrefix).toBe('pxc_ZZZZZZZZ')
    expect(JSON.stringify(details)).not.toContain(secret)
  })
})
