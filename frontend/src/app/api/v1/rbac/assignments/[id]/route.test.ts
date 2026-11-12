import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// scope-validation is intentionally NOT mocked: we exercise the PATCH route's
// real use of validateAssignmentScope (issue #383).
const {
  getServerSessionMock,
  hasPermissionMock,
  isSuperAdminMock,
  isProtectedMock,
  userRoleFindFirstMock,
  userRoleUpdateManyMock,
  roleFindUniqueMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  isProtectedMock: vi.fn(),
  userRoleFindFirstMock: vi.fn(),
  userRoleUpdateManyMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock("@/lib/auth/actingUser", async () => (await import("@/__tests__/fixtures/actingUserFromNextAuth")).actingUserFromNextAuth())
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
const tenantIdMock = vi.hoisted(() => vi.fn(async () => 'default'))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: () => tenantIdMock(), DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({
  hasPermission: hasPermissionMock,
  isUserSuperAdmin: isSuperAdminMock,
  isUserProtected: isProtectedMock,
  PROTECTED_ROLE_IDS: [],
  PROVIDER_ONLY_ROLE_IDS: [],
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findFirst: userRoleFindFirstMock, updateMany: userRoleUpdateManyMock },
    rbacRole: { findUnique: roleFindUniqueMock },
  },
}))

import { DELETE, PATCH } from './route'

const existingAssignment = {
  id: 'assign_1',
  userId: 'u1',
  roleId: 'role_x',
  scopeType: 'global',
  scopeTarget: null,
  tenantId: 'default',
  user: { email: 'u1@x' },
  role: { name: 'DB Admin' },
}

const updatedRow = (scopeType: string, scopeTarget: string | null) => ({
  id: 'assign_1',
  scopeType,
  scopeTarget,
  expiresAt: null,
  user: { id: 'u1', email: 'u1@x' },
  role: { id: 'role_x', name: 'DB Admin', color: '#fff' },
})

describe('PATCH /api/v1/rbac/assignments/[id] scope handling (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
    hasPermissionMock.mockResolvedValue(true)
    isSuperAdminMock.mockResolvedValue(true)
    isProtectedMock.mockResolvedValue(false)
  })

  it('rejects a scope_type change to a scoped type with no resolvable target', async () => {
    userRoleFindFirstMock.mockResolvedValueOnce(existingAssignment)
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'assign_1' },
      body: { scope_type: 'vm' },
    })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.error).toMatch(/scope_target/i)
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })

  it('normalizes a scope_type change to "inherit" (drops any target)', async () => {
    userRoleFindFirstMock
      .mockResolvedValueOnce(existingAssignment)
      .mockResolvedValueOnce(updatedRow('inherit', null))
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'assign_1' },
      body: { scope_type: 'inherit' },
    })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock).toHaveBeenCalled()
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeType).toBe('inherit')
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeTarget).toBeNull()
  })

  it('keeps an explicit scope target when switching to a scoped type', async () => {
    userRoleFindFirstMock
      .mockResolvedValueOnce(existingAssignment)
      .mockResolvedValueOnce(updatedRow('tag', 'web'))
    const res = await callRoute(PATCH as any, {
      method: 'PATCH',
      params: { id: 'assign_1' },
      body: { scope_type: 'tag', scope_target: 'web' },
    })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeType).toBe('tag')
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeTarget).toBe('web')
  })
  it('refuses scope widening of an existing sensitive NIC grant by a non-superadmin', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    isProtectedMock.mockResolvedValue(false)
    userRoleFindFirstMock.mockResolvedValue({ ...existingAssignment, scopeType: 'connection', scopeTarget: 'conn-1',
      role: { name: 'NIC identity', permissions: [{ permissionId: 'vm.config.nic.vlan' }] } })
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_type: 'global' } })
    expect(res.status).toBe(403)
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })
  it('lets a non-superadmin narrow or expire an existing sensitive NIC grant', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    isProtectedMock.mockResolvedValue(false)
    const sensitive = { ...existingAssignment,
      role: { name: 'NIC identity', permissions: [{ permissionId: 'vm.config.nic.mac' }] } }
    userRoleFindFirstMock.mockResolvedValueOnce(sensitive).mockResolvedValueOnce(updatedRow('connection', 'conn-1'))
    let res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_type: 'connection', scope_target: 'conn-1' } })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeType).toBe('connection')
    userRoleFindFirstMock.mockResolvedValueOnce(sensitive).mockResolvedValueOnce(updatedRow('global', null))
    res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { expires_at: '2030-01-01T00:00:00.000Z' } })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock).toHaveBeenCalledTimes(2)
  })
  it('refuses moving an assignment to a custom role of another tenant (roadmap#97)', async () => {
    isSuperAdminMock.mockResolvedValue(true)
    userRoleFindFirstMock.mockResolvedValue({ ...existingAssignment, tenantId: 't1' })
    roleFindUniqueMock.mockResolvedValue({ id: 'role_custom', name: 'Custom', tenantId: 't-other', permissions: [] })
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { role_id: 'role_custom' } })
    expect(res.status).toBe(404)
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })
  it('refuses moving an existing sensitive NIC grant to another node when only scope_target is sent', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    userRoleFindFirstMock.mockResolvedValue({ ...existingAssignment, scopeType: 'node', scopeTarget: 'c1:pve1',
      role: { name: 'NIC identity', permissions: [{ permissionId: 'vm.config.nic.mac' }] } })
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_target: 'c1:pve2' } })
    expect(res.status).toBe(403)
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })
  it('refuses a sideways move of a sensitive NIC grant disguised as a narrowing', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    userRoleFindFirstMock.mockResolvedValue({ ...existingAssignment, scopeType: 'node', scopeTarget: 'c1:pve1',
      role: { name: 'NIC identity', permissions: [{ permissionId: 'vm.config.nic.vlan' }] } })
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_type: 'vm', scope_target: 'c1:pve2:qemu:100' } })
    expect(res.status).toBe(403)
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })
  it('lets a non-superadmin narrow a sensitive NIC grant inside its current scope', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    const onNode = { ...existingAssignment, scopeType: 'node', scopeTarget: 'c1:pve1',
      role: { name: 'NIC identity', permissions: [{ permissionId: 'vm.config.nic.mac' }] } }
    userRoleFindFirstMock.mockResolvedValueOnce(onNode).mockResolvedValueOnce(updatedRow('vm', 'c1:pve1:qemu:100'))
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_type: 'vm', scope_target: 'c1:pve1:qemu:100' } })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock.mock.calls[0][0].data).toMatchObject({ scopeType: 'vm', scopeTarget: 'c1:pve1:qemu:100' })
  })
  it('drops a scope_target sent alone for an unscoped assignment', async () => {
    userRoleFindFirstMock.mockResolvedValueOnce(existingAssignment).mockResolvedValueOnce(updatedRow('global', null))
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'assign_1' }, body: { scope_target: 'c1:pve1' } })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock.mock.calls[0][0].data).toMatchObject({ scopeType: 'global', scopeTarget: null })
  })

})

describe('service desk rows are read-only here (ui#1336)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
    hasPermissionMock.mockResolvedValue(true)
    isSuperAdminMock.mockResolvedValue(true)
    isProtectedMock.mockResolvedValue(false)
    userRoleFindFirstMock.mockResolvedValue({ ...existingAssignment, id: 'sd_sda_1_t1' })
  })

  it('refuses to change or revoke a row a service desk assignment owns', async () => {
    for (const res of [
      await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'sd_sda_1_t1' }, body: { scope_type: 'global' } }),
      await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'sd_sda_1_t1' } }),
    ]) {
      expect(res.status).toBe(409)
      expect((await readJson<any>(res)).code).toBe('SERVICE_DESK_MANAGED')
    }
    expect(userRoleUpdateManyMock).not.toHaveBeenCalled()
  })

  it('refuses a customer tenant the SSO row of a service desk role, and leaves it to the provider', async () => {
    const sso = { ...existingAssignment, id: 'oidc_1', tenantId: 't1', role: { ...existingAssignment.role, audience: 'service_desk' } }
    userRoleFindFirstMock.mockResolvedValue(sso)
    tenantIdMock.mockResolvedValue('t1')
    for (const res of [
      await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'oidc_1' }, body: { scope_type: 'global' } }),
      await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'oidc_1' } }),
    ]) {
      expect(res.status).toBe(409)
      expect((await readJson<any>(res)).code).toBe('SERVICE_DESK_MANAGED')
    }
    tenantIdMock.mockResolvedValue('default')
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'oidc_1' } })
    expect(res.status).not.toBe(409)
  })
})
