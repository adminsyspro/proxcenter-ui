// Self-review evidence for Task 11 (management routes), verified with real
// assertions rather than by reasoning:
//   A. the clear-text secret is present in the creation response and in no
//      other response (GET list, DELETE);
//   B. a created token actually authenticates through the REAL getPrincipal
//      (Task 9), proving the stored hash matches the returned secret;
//   C. revoking a token makes that same, previously-working token fail the
//      REAL getPrincipal check;
//   D. POST is refused without api_access while GET and DELETE still work
//      (D6 asymmetric gating).
//
// Only the admin-side guard (@/lib/rbac, @/lib/tenant, @/lib/audit) is
// mocked, same as apiTokensRoutes.test.ts. getPrincipal, tokenCrypto and the
// allowlist run for REAL against the REAL Postgres row created by POST.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getCurrentTenantIdMock,
  userHasAccessToTenantMock, auditMock, headersMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  getRBACContextMock: vi.fn<() => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  userHasAccessToTenantMock: vi.fn<() => Promise<boolean>>(),
  auditMock: vi.fn<() => Promise<string>>(),
  headersMock: vi.fn<() => Promise<Headers>>(),
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

vi.mock('@/lib/audit', () => ({ audit: auditMock }))

// getPrincipal reads Authorization/x-pxc-* via next/headers(); route through
// a mock the same way principal.test.ts does, so the REST of getPrincipal
// (tokenCrypto, allowlist, scopes, DB lookup) runs unmocked.
vi.mock('next/headers', () => ({ headers: headersMock }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { ENTERPRISE_WITH_API_ACCESS, seedApiToken, seedDefaultTenant, tokenHeaders } from '@/__tests__/setup/apiTokens'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import type { ServerLicense } from '@/lib/auth/requireEnterprise'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'
import { getPrincipal } from '@/lib/auth/principal'

const UNLICENSED: ServerLicense = {
  enterprise: false,
  edition: 'community',
  licensed: false,
  expired: false,
  features: [],
  options: [],
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('default')
  userHasAccessToTenantMock.mockResolvedValue(true)
  getRBACContextMock.mockResolvedValue({ userId: 'admin-1', isAdmin: true, tenantId: 'default' })
  auditMock.mockResolvedValue('audit-id')
  headersMock.mockResolvedValue(new Headers())
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  _resetLicenseVerdictCache()
  await truncate(['api_tokens', 'tenants', 'users'])
  await seedDefaultTenant()
  const now = new Date()
  await prismaTest.user.create({
    data: { id: 'admin-1', email: 'admin-1@test.local', createdAt: now, updatedAt: now },
  })
})

describe('self-review A: secret is revealed once, nowhere else', () => {
  it('appears in the POST response but never in GET or DELETE bodies', async () => {
    const { POST } = await import('./route')
    const { GET } = await import('./route')
    const { DELETE } = await import('./[id]/route')

    const createRes = await callRoute(POST, { body: { name: 'once-only', scopes: ['vms:read'] } })
    expect(createRes.status).toBe(201)
    const created = await readJson<any>(createRes)
    const secret: string = created.data.secret
    expect(secret).toMatch(/^pxc_/)
    // Sanity: the creation body really does carry it.
    expect(JSON.stringify(created)).toContain(secret)

    const listRes = await callRoute(GET)
    const listBody = await readJson<any>(listRes)
    expect(JSON.stringify(listBody)).not.toContain(secret)

    const deleteRes = await callRoute(DELETE, { method: 'DELETE', params: { id: created.data.token.id } })
    const deleteBody = await readJson<any>(deleteRes)
    expect(JSON.stringify(deleteBody)).not.toContain(secret)
  })
})

describe('self-review B/C: the returned secret really authenticates, and revocation really breaks it', () => {
  it('authenticates via the real getPrincipal, then stops authenticating once revoked', async () => {
    const { POST } = await import('./route')
    const { DELETE } = await import('./[id]/route')

    const createRes = await callRoute(POST, { body: { name: 'auth-check', scopes: ['vms:read'] } })
    expect(createRes.status).toBe(201)
    const created = await readJson<any>(createRes)
    const secret: string = created.data.secret
    const tokenId: string = created.data.token.id

    // B: the exact secret handed back to the caller authenticates for real
    // (proves stored hash == hash(returned secret), not some other value).
    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const before = await getPrincipal()
    expect(before.ok).toBe(true)
    expect(before.principal?.kind).toBe('token')
    expect(before.principal?.tokenId).toBe(tokenId)

    // C: revoke through the route under test, then replay the identical
    // request — the same secret must now be rejected.
    const revokeRes = await callRoute(DELETE, { method: 'DELETE', params: { id: tokenId } })
    expect(revokeRes.status).toBe(200)

    headersMock.mockResolvedValue(tokenHeaders(secret, 'vms-list', '/api/v1/vms'))
    const after = await getPrincipal()
    expect(after.ok).toBe(false)
    expect(after.rejection?.status).toBe(401)
  })
})

describe('self-review D: asymmetric licence gating (D6)', () => {
  it('refuses POST without api_access while GET and DELETE keep working', async () => {
    const seeded = await seedApiToken({ scopes: ['vms:read'] })

    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(UNLICENSED)
    _resetLicenseVerdictCache()

    const { GET, POST } = await import('./route')
    const { DELETE } = await import('./[id]/route')

    const postRes = await callRoute(POST, { body: { name: 'blocked', scopes: ['vms:read'] } })
    expect(postRes.status).toBe(403)

    const getRes = await callRoute(GET)
    expect(getRes.status).toBe(200)
    const getBody = await readJson<any>(getRes)
    expect(getBody.data.some((t: any) => t.id === seeded.id)).toBe(true)

    const deleteRes = await callRoute(DELETE, { method: 'DELETE', params: { id: seeded.id } })
    expect(deleteRes.status).toBe(200)
    const row = await prismaTest.apiToken.findUnique({ where: { id: seeded.id } })
    expect(row?.revokedAt).not.toBeNull()
  })
})
