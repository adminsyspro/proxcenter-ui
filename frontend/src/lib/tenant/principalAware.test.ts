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
import { resolveVisibleConnectionIds } from '@/lib/api-tokens/scope'
import { audit } from '@/lib/audit'
import { getCurrentTenantId } from './index'

// operatingModel: non-default tenants must carry one (CHECK
// tenant_default_has_no_model, msp_alpha1_schema migration).
function tenantRow(id: string, extra: Record<string, unknown> = {}) {
  const now = new Date()
  return { id, slug: id, name: id, operatingModel: 'msp', createdAt: now, updatedAt: now, ...extra }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  headersMock.mockResolvedValue(new Headers())
  getServerSessionMock.mockResolvedValue(null)
  await truncate(['api_tokens', 'tenants', 'Connection', 'audit_logs'])
  await seedDefaultTenant()
})

describe('getCurrentTenantId, token branch', () => {
  it('returns the token tenant with NO fallback and NO membership check', async () => {
    await prismaTest.tenant.create({ data: tenantRow('tenant-b', { name: 'B' }) })
    const { secret } = await seedApiToken({ tenantId: 'tenant-b' })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    expect(await getCurrentTenantId()).toBe('tenant-b')
  })

  it('throws (fail-closed) on an invalid Bearer instead of falling back to default', async () => {
    headersMock.mockResolvedValue(new Headers({ authorization: 'Bearer pxc_invalid-token' }))
    await expect(getCurrentTenantId()).rejects.toThrow('Invalid or expired API token')
  })

  it('throws (never promotes to default) when the token tenant is disabled', async () => {
    await prismaTest.tenant.create({ data: tenantRow('dead', { name: 'Dead', enabled: false }) })
    const { secret } = await seedApiToken({ tenantId: 'dead' })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    await expect(getCurrentTenantId()).rejects.toThrow('Invalid or expired API token')
  })
})

describe('getCurrentTenantId, session regression', () => {
  it('falls back to default without a session', async () => {
    expect(await getCurrentTenantId()).toBe('default')
  })

  it('falls back to default when the JWT claims a missing tenant', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'ghost-tenant' } })
    expect(await getCurrentTenantId()).toBe('default')
  })

  it('falls back to default when the claimed tenant is disabled', async () => {
    await prismaTest.tenant.create({ data: tenantRow('off', { name: 'Off', enabled: false }) })
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'off' } })
    expect(await getCurrentTenantId()).toBe('default')
  })

  it('tenant/index.ts no longer references getServerSession', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/lib/tenant/index.ts', 'utf8')
    expect(source.includes('getServerSession')).toBe(false)
  })
})

describe('hard gate: no all-tenant disclosure through the ambient tenant fallback', () => {
  // A default-tenant PVE connection would need a provider_connections row
  // (enforce_connection_pool_sync trigger), so the foreign connection lives
  // in a third MSP tenant — the disclosure being tested is identical.
  async function seedCrossTenantFixture() {
    await prismaTest.tenant.create({ data: tenantRow('tenant-b', { name: 'B' }) })
    await prismaTest.tenant.create({ data: tenantRow('tenant-c', { name: 'C' }) })
    await prismaTest.connection.create({
      data: { id: 'conn-b', tenantId: 'tenant-b', name: 'b', baseUrl: 'https://pve-b:8006', apiTokenEnc: 'enc' },
    })
    await prismaTest.connection.create({
      data: { id: 'conn-c', tenantId: 'tenant-c', name: 'c', baseUrl: 'https://pve-c:8006', apiTokenEnc: 'enc' },
    })
  }

  it('a non-default-tenant token with null connectionIds never sees another tenant connection', async () => {
    await seedCrossTenantFixture()
    const { secret } = await seedApiToken({ tenantId: 'tenant-b', scopes: ['vms:read'], connectionIds: null })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const visible = await resolveVisibleConnectionIds({ tenantId: 'tenant-b', connectionIds: null })
    expect(visible.has('conn-c')).toBe(false)
    expect(visible.has('conn-b')).toBe(true)
  })

  it('a provider-tenant token (tenant=default) correctly keeps the whole fleet', async () => {
    await seedCrossTenantFixture()
    const { secret } = await seedApiToken({ tenantId: 'default', scopes: ['vms:read'], connectionIds: null })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const visible = await resolveVisibleConnectionIds({ tenantId: 'default', connectionIds: null })
    expect(visible.has('conn-b')).toBe(true)
    expect(visible.has('conn-c')).toBe(true)
  })
})

describe('audit attribution under token authentication', () => {
  it('scopes the row to the token tenant and never attributes it to a user', async () => {
    await prismaTest.tenant.create({ data: tenantRow('tenant-b', { name: 'B' }) })
    const { secret } = await seedApiToken({ tenantId: 'tenant-b' })
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const id = await audit({ action: 'read', category: 'system' })
    const row = await prismaTest.auditLog.findUnique({ where: { id } })
    expect(row?.tenantId).toBe('tenant-b')
    expect(row?.userId).toBeNull()
    expect(row?.userEmail).toBeNull()
  })
})
