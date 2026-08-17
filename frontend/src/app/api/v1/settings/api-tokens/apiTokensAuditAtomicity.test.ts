// Fix round 1, findings 1 and 2: the token row change (its creation, and now
// its removal) and its audit row must be one transaction. Proven here with a REAL forced audit
// insert failure (a primary-key collision on audit_logs.id, a real Postgres
// constraint), not a mocked throw — @/lib/audit itself is NOT mocked in
// this file, only the admin-side guard (@/lib/rbac, @/lib/tenant) and the
// license gate are, same as the other test files in this directory.
//
// nanoid is mocked so the test can predict — and collide with — the id
// audit() generates for its own row, without touching production code.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getCurrentTenantIdMock,
  userHasAccessToTenantMock, nanoidMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  getRBACContextMock: vi.fn<() => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  userHasAccessToTenantMock: vi.fn<() => Promise<boolean>>(),
  nanoidMock: vi.fn<() => string>(),
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

// Both route.ts (token id) and @/lib/audit/index.ts (audit row id) import
// nanoid from this package — mocking it controls BOTH ids deterministically.
vi.mock('nanoid', () => ({ nanoid: nanoidMock }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { ENTERPRISE_WITH_API_ACCESS, seedApiToken, seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('default')
  userHasAccessToTenantMock.mockResolvedValue(true)
  getRBACContextMock.mockResolvedValue({ userId: 'admin-1', isAdmin: true, tenantId: 'default' })
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  _resetLicenseVerdictCache()
  await truncate(['api_tokens', 'audit_logs', 'tenants', 'users'])
  await seedDefaultTenant()
  const now = new Date()
  await prismaTest.user.create({
    data: { id: 'admin-1', email: 'admin-1@test.local', createdAt: now, updatedAt: now },
  })
})

async function seedColliding(id: string) {
  await prismaTest.auditLog.create({
    data: { id, tenantId: 'default', timestamp: new Date(), action: 'create', category: 'system' },
  })
}

describe('POST create: token row and audit row are one transaction', () => {
  it('rolls back token creation when the audit insert fails', async () => {
    // 1st nanoid() call is route.ts's `id: nanoid()` for the new token row;
    // 2nd is audit()'s own `const id = nanoid()`. Pre-seeding a real
    // audit_logs row with that second id forces a genuine primary-key
    // violation on the INSERT audit() issues inside the transaction.
    nanoidMock.mockReturnValueOnce('atomic-create-token-id').mockReturnValueOnce('colliding-audit-id-1')
    await seedColliding('colliding-audit-id-1')

    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { name: 'atomic-check', scopes: ['vms:read'] } })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBeTruthy()

    const row = await prismaTest.apiToken.findUnique({ where: { id: 'atomic-create-token-id' } })
    expect(row).toBeNull()
  })

  it('creates both rows when the audit insert succeeds (control case)', async () => {
    nanoidMock.mockReturnValueOnce('atomic-create-token-id-2').mockReturnValueOnce('audit-id-ok-1')

    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { name: 'atomic-control', scopes: ['vms:read'] } })

    expect(res.status).toBe(201)
    const row = await prismaTest.apiToken.findUnique({ where: { id: 'atomic-create-token-id-2' } })
    expect(row).not.toBeNull()
    const auditRow = await prismaTest.auditLog.findUnique({ where: { id: 'audit-id-ok-1' } })
    expect(auditRow?.action).toBe('apitoken.create')
  })
})

// Now that the DELETE removes the row instead of stamping it, the stake of
// this atomicity is higher than it was for revocation: a credential vanishing
// with no journal entry to show for it leaves nothing, anywhere, to say the
// token ever existed. So the rollback assertion is "the row is STILL THERE".
describe('DELETE: the row removal and the audit row are one transaction', () => {
  it('leaves the token row in place when the audit insert fails', async () => {
    const { id } = await seedApiToken()
    // The only nanoid() call on this path is audit()'s own row id.
    nanoidMock.mockReturnValueOnce('colliding-audit-id-2')
    await seedColliding('colliding-audit-id-2')

    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })

    expect(res.status).toBe(500)
    const row = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(row).not.toBeNull()
    expect(row?.id).toBe(id)
  })

  it('removes the row when the audit insert succeeds (control case)', async () => {
    const { id } = await seedApiToken()
    nanoidMock.mockReturnValueOnce('audit-id-ok-2')

    const { DELETE } = await import('./[id]/route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id } })

    expect(res.status).toBe(200)
    const row = await prismaTest.apiToken.findUnique({ where: { id } })
    expect(row).toBeNull()
    const auditRow = await prismaTest.auditLog.findUnique({ where: { id: 'audit-id-ok-2' } })
    expect(auditRow?.action).toBe('apitoken.delete')
  })
})
