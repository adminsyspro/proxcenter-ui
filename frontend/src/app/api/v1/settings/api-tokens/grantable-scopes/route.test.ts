import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, getRBACContextMock, getCurrentTenantIdMock, userHasAccessToTenantMock, holdsMock } =
  vi.hoisted(() => ({
    checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
    getRBACContextMock: vi.fn<() => Promise<any>>(),
    getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
    userHasAccessToTenantMock: vi.fn<() => Promise<boolean>>(),
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
const { serviceAccountMock } = vi.hoisted(() => ({ serviceAccountMock: vi.fn<(id: string) => Promise<any>>() }))
vi.mock('@/lib/service-accounts', () => ({ getServiceAccount: serviceAccountMock }))
vi.mock('@/lib/api-tokens/selfService', () => ({ apiSelfServiceRefusal: async () => null }))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { ALL_SCOPE_IDS, FLEET_SCOPE_IDS, isCreatorCheckedScope, READ_SCOPE_IDS } from '@/lib/api-tokens/scopes'

// The read scopes anyone holding admin.apitokens may grant; the admin reads
// (issue #1360) need their keys held, like a write scope.
const OPEN_READ_SCOPE_IDS = READ_SCOPE_IDS.filter(id => !isCreatorCheckedScope(id))

// A user whose only grant is connection c1 with connection.view + connection.manage.
const grantOnC1 = async (_u: string, _t: string, key: string, conns: string[] | null) =>
  ['connection.view', 'connection.manage'].includes(key) && !!conns && conns.length > 0 && conns.every(c => c === 'c1')

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('default')
  userHasAccessToTenantMock.mockResolvedValue(true)
  getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
  holdsMock.mockImplementation(grantOnC1)
})

const get = async (searchParams: Record<string, string> = {}) => {
  const { GET } = await import('./route')
  return callRoute(GET, { searchParams })
}

describe('GET /api/v1/settings/api-tokens/grantable-scopes', () => {
  it('denies without admin.apitokens', async () => {
    checkPermissionMock.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await get()).status).toBe(403)
  })

  it('includes pools:write for connectionIds=c1 when the grant covers its keys', async () => {
    const body = await readJson<any>(await get({ connectionIds: 'c1' }))
    expect(body.data.grantable).toContain('pools:write')
    expect(body.data.grantable).not.toContain('vms:power')
    for (const id of OPEN_READ_SCOPE_IDS) expect(body.data.grantable).toContain(id)
    expect(body.data.grantable).not.toContain('users:read')
  })

  it('excludes pools:write when connectionIds is absent (all connections)', async () => {
    const body = await readJson<any>(await get())
    expect(body.data.grantable).not.toContain('pools:write')
    expect(body.data.grantable).toEqual(OPEN_READ_SCOPE_IDS)
  })

  it('offers an admin read scope only to a creator holding its keys tenant-wide (issue #1360)', async () => {
    holdsMock.mockImplementation(async (_u: string, _t: string, key: string) => key === 'admin.users.view')
    const body = await readJson<any>(await get())
    expect(body.data.grantable).toContain('users:read')
    expect(body.data.grantable).not.toContain('rbac:read')
    expect(body.data.grantable).not.toContain('tenants:read')
    expect(holdsMock).toHaveBeenCalledWith('u1', 'default', 'admin.users.view', null)
  })

  it('returns every scope for a super admin', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 'default' })
    const body = await readJson<any>(await get())
    expect(body.data.grantable).toEqual(ALL_SCOPE_IDS)
  })

  it('never offers a fleet scope for a token restricted to connections, super admin included (issue #1360)', async () => {
    holdsMock.mockResolvedValue(true)
    expect((await readJson<any>(await get({ connectionIds: 'c1' }))).data.grantable).not.toContain('vdcs:write')
    expect((await readJson<any>(await get())).data.grantable).toContain('vdcs:write')
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 'default' })
    const restricted = await readJson<any>(await get({ connectionIds: 'c1' }))
    expect(restricted.data.grantable).toEqual(ALL_SCOPE_IDS.filter(id => !FLEET_SCOPE_IDS.includes(id)))
    for (const id of ['tenants:write', 'users:write', 'rbac:write']) expect(restricted.data.grantable).not.toContain(id)
  })

  it('refuses a tenant the non-admin cannot access', async () => {
    userHasAccessToTenantMock.mockResolvedValue(false)
    const res = await get({ tenantId: 'other' })
    expect(res.status).toBe(403)
    expect(userHasAccessToTenantMock).toHaveBeenCalledWith('u1', 'other')
  })

  it('uses the requested tenant for the checks', async () => {
    await get({ tenantId: 't2', connectionIds: 'c1' })
    expect(holdsMock).toHaveBeenCalledWith('u1', 't2', expect.any(String), ['c1'])
  })
})

describe('grantable scopes for a service account token (#1404)', () => {
  beforeEach(() => {
    serviceAccountMock.mockImplementation(async (id: string) =>
      id === 'sa-acme' ? { id: 'sa-acme', tenantId: 'acme' } : null)
  })

  it('judges in the account tenant and keeps only the scopes the account holds, reads included', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'admin', isAdmin: true, tenantId: 'default' })
    holdsMock.mockImplementation(async (userId: string, tenantId: string, key: string) =>
      userId === 'sa-acme' && tenantId === 'acme' && key === 'vm.view')
    const body = await readJson<any>(await get({ serviceAccountId: 'sa-acme' }))
    expect(body.data.grantable).toEqual(['vms:read'])
  })

  it('answers 404 for an account the caller does not reach', async () => {
    getCurrentTenantIdMock.mockResolvedValue('beta')
    expect((await get({ serviceAccountId: 'sa-acme' })).status).toBe(404)
    expect((await get({ serviceAccountId: 'nope' })).status).toBe(404)
  })
})

describe('a customer tenant token never offers a provider-only scope (#1404)', () => {
  it('drops tenants:* and vdcs:write outside the provider tenant', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'admin', isAdmin: true, tenantId: 'default' })
    const body = await readJson<any>(await get({ tenantId: 'acme' }))
    for (const scope of ['tenants:read', 'tenants:write', 'vdcs:write']) expect(body.data.grantable).not.toContain(scope)
    expect(body.data.grantable).toContain('vms:read')
    const provider = await readJson<any>(await get({ tenantId: 'default' }))
    expect(provider.data.grantable).toContain('vdcs:write')
  })
})
