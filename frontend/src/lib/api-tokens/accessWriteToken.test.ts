/**
 * Issue #1360, writes on tenants, users and role assignments: real routes,
 * real guard and real grant rules, an API token principal. A token is never a
 * super admin, never acts on its own creator, never sets a credential on an
 * existing account, and needs a perimeter not restricted to connections.
 * The principal, tenant, RBAC verdicts, creator check and database are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creator: vi.fn<(...a: any[]) => Promise<boolean>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  isProtected: vi.fn<(id: string) => Promise<boolean>>(),
  addUserToTenant: vi.fn<(...a: any[]) => Promise<void>>(),
  removeUserFromTenant: vi.fn<(...a: any[]) => Promise<void>>(),
  deleteTenant: vi.fn<(...a: any[]) => Promise<boolean>>(),
  vdcCount: vi.fn<(...a: any[]) => Promise<number>>(),
  userFindUnique: vi.fn<(...a: any[]) => Promise<any>>(),
  userUpdate: vi.fn<(...a: any[]) => Promise<any>>(),
  userDelete: vi.fn<(...a: any[]) => Promise<any>>(),
  roleFindUnique: vi.fn<(...a: any[]) => Promise<any>>(),
  grantFindFirst: vi.fn<(...a: any[]) => Promise<any>>(),
  grantCreate: vi.fn<(...a: any[]) => Promise<any>>(),
  grantDeleteMany: vi.fn<(...a: any[]) => Promise<any>>(),
  membership: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
}))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({
  creatorStillHolds: (...a: any[]) => h.creator(...a),
  creatorStillHoldsPermission: async () => true,
}))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: async () => ({ kind: 'provider' }) }))
vi.mock('@/lib/tenant/constants', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/tenant/vmidRange', () => ({ parseVmidRangeInput: () => ({ ok: true }), findVmidRangeConflict: async () => null }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  requireProviderTenant: async () => null,
  listTenants: vi.fn(), createTenant: vi.fn(), updateTenant: vi.fn(), getTenantUsers: vi.fn(),
  deleteTenant: (...a: any[]) => h.deleteTenant(...a),
  addUserToTenant: (...a: any[]) => h.addUserToTenant(...a),
  removeUserFromTenant: (...a: any[]) => h.removeUserFromTenant(...a),
  TenantMembershipError: class extends Error {},
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  hasPermission: async () => { throw new Error('a token is never checked as a user') },
  getRBACContext: async () => {
    const result = await h.getPrincipal()
    return result?.principal ? { isAdmin: false, tenantId: result.principal.tenantId, principal: result.principal } : null
  },
  grantsPermission: (set: Set<string>, p: string) => set.has(p),
  isUserSuperAdmin: async () => false,
  isUserProtected: (id: string) => h.isProtected(id),
  PERMISSIONS: {
    ADMIN_TENANTS: 'admin.tenants', ADMIN_TENANTS_VIEW: 'admin.tenants.view', ADMIN_USERS: 'admin.users',
    ADMIN_USERS_VIEW: 'admin.users.view', ADMIN_RBAC_VIEW: 'admin.rbac.view',
  },
  PROTECTED_ROLE_IDS: ['role_super_admin', 'role_provider_admin'],
  PROVIDER_ONLY_ROLE_IDS: ['role_viewer'],
}))
vi.mock('@/lib/rbac/serviceDesk', () => ({
  isServiceDeskAccount: async () => false,
  isServiceDeskManaged: () => false,
  syncServiceDeskForNewTenant: vi.fn(),
  SERVICE_DESK_ACCOUNT_ERROR: { error: 'service desk' },
  SERVICE_DESK_ROW_PREFIX: 'sd_',
}))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: async () => 'hash' }))
vi.mock('@/lib/auth/sessions', () => ({ revokeAllSessions: async () => 0, aliveWhere: () => ({}) }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ getServerLicense: async () => ({ enterprise: true }) }))
vi.mock('@/lib/auth/communitySuperAdmin', () => ({ isCommunityDeployment: () => false, hasNonDefaultTenant: async () => true }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: any) => handler }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdc: { count: (...a: any[]) => h.vdcCount(...a) },
    user: {
      findUnique: (...a: any[]) => h.userFindUnique(...a),
      update: (...a: any[]) => h.userUpdate(...a),
      delete: (...a: any[]) => h.userDelete(...a),
    },
    userTenant: { findUnique: (...a: any[]) => h.membership(...a), count: async () => 0, findMany: async () => [], deleteMany: vi.fn() },
    rbacRole: { findUnique: (...a: any[]) => h.roleFindUnique(...a) },
    rbacUserRole: {
      findFirst: (...a: any[]) => h.grantFindFirst(...a),
      create: (...a: any[]) => h.grantCreate(...a),
      deleteMany: (...a: any[]) => h.grantDeleteMany(...a),
    },
    rbacUserPermission: { deleteMany: vi.fn() },
    $transaction: async (ops: any) => (typeof ops === 'function' ? ops({}) : Promise.all(ops)),
  },
}))

import { DELETE as TENANT_DELETE } from '@/app/api/v1/tenants/[id]/route'
import { POST as TENANT_CREATE } from '@/app/api/v1/tenants/route'
import { DELETE as MEMBER_REMOVE, POST as MEMBER_ADD } from '@/app/api/v1/tenants/[id]/users/route'
import { DELETE as USER_DELETE, PATCH as USER_UPDATE } from '@/app/api/v1/users/[id]/route'
import { POST as ASSIGN } from '@/app/api/v1/rbac/assignments/route'
import { DELETE as REVOKE } from '@/app/api/v1/rbac/assignments/[id]/route'
import { FLEET_ONLY } from './writeGuards'

const token = (scope: string, connectionIds: string[] | null = null) => ({
  kind: 'token', tokenId: 'tok-1', tenantId: 'default', creatorUserId: 'creator', connectionIds, scopes: [scope],
  permissions: new Set(['admin.tenants', 'admin.users', 'admin.rbac']),
})

function call(scope: string, entry: string, method: string, path: string, body?: unknown, connectionIds: string[] | null = null) {
  h.getPrincipal.mockResolvedValue({ ok: true, principal: token(scope, connectionIds) })
  h.headers.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': method, 'x-pxc-path': path.split('?')[0], 'x-pxc-entry': entry,
  }))
  return new Request(`http://test.local${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const error = async (res: Response) => (await res.json()).error

const TENANT_ROLE = { id: 'role_tenant_viewer', name: 'Viewer', isSystem: true, tenantId: null, audience: null, publishAll: false, publications: [], permissions: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.checkPermission.mockResolvedValue(null)
  h.creator.mockResolvedValue(true)
  h.audit.mockResolvedValue('audit-id')
  h.isProtected.mockResolvedValue(false)
  h.vdcCount.mockResolvedValue(0)
  h.deleteTenant.mockResolvedValue(true)
  h.userFindUnique.mockImplementation(async ({ where }: any) => ({
    id: where.id, email: `${where.id}@x`, name: 'N', enabled: true, role: 'user', authProvider: 'credentials',
    localLoginAllowed: false, password: 'hash', lastLoginAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  }))
  h.userUpdate.mockImplementation(async ({ where, data }: any) => ({ ...(await h.userFindUnique({ where })), ...data }))
  h.roleFindUnique.mockResolvedValue(TENANT_ROLE)
  h.grantFindFirst.mockResolvedValue(null)
  h.membership.mockResolvedValue({ userId: 'u2' })
})

describe('perimeter and creator, before any handler', () => {
  it.each([
    ['tenants:write', 'tenant-create', TENANT_CREATE, 'POST', '/api/v1/tenants'],
    ['rbac:write', 'rbac-assignment-create', ASSIGN, 'POST', '/api/v1/rbac/assignments'],
  ] as const)('refuses a %s token restricted to connections', async (scope, entry, handler, method, path) => {
    const res = await (handler as any)(call(scope, entry, method, path, {}, ['c1']))
    expect(res.status).toBe(403)
    expect(await error(res)).toBe(FLEET_ONLY)
    expect(h.checkPermission).not.toHaveBeenCalled()
  })

  it('refuses a token whose creator lost the admin right', async () => {
    h.creator.mockResolvedValue(false)
    const res = await USER_DELETE(call('users:write', 'user-delete', 'DELETE', '/api/v1/users/u2'), params('u2'))
    expect(res.status).toBe(403)
    expect(h.userDelete).not.toHaveBeenCalled()
  })
})

describe('tenants through a tenants:write token', () => {
  it('refuses to delete a tenant that still has vDCs, before anything is revoked', async () => {
    h.vdcCount.mockResolvedValue(2)
    const res = await TENANT_DELETE(call('tenants:write', 'tenant-delete', 'DELETE', '/api/v1/tenants/t1'), params('t1'))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('TENANT_HAS_VDCS')
    expect(h.deleteTenant).not.toHaveBeenCalled()
  })

  it('deletes an empty tenant, the journal row carrying no user', async () => {
    const res = await TENANT_DELETE(call('tenants:write', 'tenant-delete', 'DELETE', '/api/v1/tenants/t1'), params('t1'))
    expect(res.status).toBe(200)
    expect(h.deleteTenant).toHaveBeenCalledWith('t1')
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.delete', userId: undefined }))
  })

  it('never adds or removes its own creator', async () => {
    const add = await MEMBER_ADD(call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/t1/users', { userId: 'creator' }), params('t1'))
    const remove = await MEMBER_REMOVE(call('tenants:write', 'tenant-user-remove', 'DELETE', '/api/v1/tenants/t1/users?userId=creator'), params('t1'))
    for (const res of [add, remove]) {
      expect(res.status).toBe(403)
      expect(await error(res)).toMatch(/creator/)
    }
    expect(h.addUserToTenant).not.toHaveBeenCalled()
    expect(h.removeUserFromTenant).not.toHaveBeenCalled()
  })

  it('reads a provider operator as unknown', async () => {
    h.isProtected.mockResolvedValue(true)
    const res = await MEMBER_ADD(call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/t1/users', { userId: 'root' }), params('t1'))
    expect(res.status).toBe(404)
    expect(h.addUserToTenant).not.toHaveBeenCalled()
  })

  it('answers 404 for a user that does not exist', async () => {
    h.userFindUnique.mockResolvedValue(null)
    const res = await MEMBER_ADD(call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/t1/users', { userId: 'ghost' }), params('t1'))
    expect(res.status).toBe(404)
    expect(h.addUserToTenant).not.toHaveBeenCalled()
  })

  it('adds a member with the viewer role, granted by nobody', async () => {
    const res = await MEMBER_ADD(call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/t1/users', { userId: 'u2' }), params('t1'))
    expect(res.status).toBe(200)
    expect(h.addUserToTenant).toHaveBeenCalledWith('u2', 't1', false)
    expect(h.grantCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u2', roleId: 'role_tenant_viewer', tenantId: 't1', grantedById: null })
  })

  it('refuses a protected role as unknown', async () => {
    const res = await MEMBER_ADD(
      call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/default/users', { userId: 'u2', roleId: 'role_super_admin' }),
      params('default'),
    )
    expect(res.status).toBe(404)
    expect(h.addUserToTenant).not.toHaveBeenCalled()
  })

  it('answers 400 for a userId that is not a string', async () => {
    const res = await MEMBER_ADD(call('tenants:write', 'tenant-user-add', 'POST', '/api/v1/tenants/t1/users', { userId: ['creator'] }), params('t1'))
    expect(res.status).toBe(400)
    expect(h.addUserToTenant).not.toHaveBeenCalled()
  })

  it('removes the member named in the query string', async () => {
    const res = await MEMBER_REMOVE(call('tenants:write', 'tenant-user-remove', 'DELETE', '/api/v1/tenants/t1/users?userId=u2'), params('t1'))
    expect(res.status).toBe(200)
    expect(h.removeUserFromTenant).toHaveBeenCalledWith('u2', 't1')
  })
})

describe('users through a users:write token', () => {
  it('never changes nor deletes the account of its creator', async () => {
    const patch = await USER_UPDATE(call('users:write', 'user-update', 'PATCH', '/api/v1/users/creator', { name: 'Me' }), params('creator'))
    const del = await USER_DELETE(call('users:write', 'user-delete', 'DELETE', '/api/v1/users/creator'), params('creator'))
    for (const res of [patch, del]) {
      expect(res.status).toBe(403)
      expect(await error(res)).toMatch(/creator/)
    }
    expect(h.userUpdate).not.toHaveBeenCalled()
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it.each([[{ password: 'new-password-1' }], [{ localLoginAllowed: true }], [{ name: 'X', password: 'new-password-1' }]])(
    'never sets a credential on an existing account (%j)', async body => {
      const res = await USER_UPDATE(call('users:write', 'user-update', 'PATCH', '/api/v1/users/u2', body), params('u2'))
      expect(res.status).toBe(403)
      expect(await error(res)).toMatch(/password/)
      expect(h.userUpdate).not.toHaveBeenCalled()
    })

  it('reads a provider operator as unknown', async () => {
    h.isProtected.mockResolvedValue(true)
    const res = await USER_UPDATE(call('users:write', 'user-update', 'PATCH', '/api/v1/users/root', { enabled: false }), params('root'))
    expect(res.status).toBe(404)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('disables another account under admin.users', async () => {
    const res = await USER_UPDATE(call('users:write', 'user-update', 'PATCH', '/api/v1/users/u2', { enabled: false }), params('u2'))
    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('admin.users')
    expect(h.userUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'u2' }, data: { enabled: false } })
  })
})

describe('role assignments through a rbac:write token', () => {
  const assign = (body: unknown) => ASSIGN(call('rbac:write', 'rbac-assignment-create', 'POST', '/api/v1/rbac/assignments', body))

  it('needs admin.rbac from its scope', async () => {
    h.checkPermission.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await assign({ user_id: 'u2', role_id: 'role_tenant_viewer' })).status).toBe(403)
    expect(h.checkPermission).toHaveBeenCalledWith('admin.rbac')
    expect(h.grantCreate).not.toHaveBeenCalled()
  })

  it('never grants a role to its creator', async () => {
    const res = await assign({ user_id: 'creator', role_id: 'role_tenant_viewer' })
    expect(res.status).toBe(400)
    expect(await error(res)).toBe('An API token cannot change the roles of its creator')
    expect(h.grantCreate).not.toHaveBeenCalled()
  })

  it('reads a protected role and a protected user as unknown', async () => {
    expect((await assign({ user_id: 'u2', role_id: 'role_provider_admin' })).status).toBe(404)
    h.isProtected.mockResolvedValue(true)
    expect((await assign({ user_id: 'root', role_id: 'role_tenant_viewer' })).status).toBe(404)
    expect(h.grantCreate).not.toHaveBeenCalled()
  })

  it('keeps NIC identity rights to a super admin', async () => {
    h.roleFindUnique.mockResolvedValue({ ...TENANT_ROLE, permissions: [{ permissionId: 'vm.config.nic.mac' }] })
    const res = await assign({ user_id: 'u2', role_id: 'role_tenant_viewer' })
    expect(res.status).toBe(403)
    expect(h.grantCreate).not.toHaveBeenCalled()
  })

  it('grants a role in another tenant, granted by nobody', async () => {
    const res = await assign({ user_id: 'u2', role_id: 'role_tenant_viewer', tenant_id: 'default' })
    expect(res.status).toBe(201)
    expect(h.grantCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u2', roleId: 'role_tenant_viewer', scopeType: 'inherit', grantedById: null })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'rbac_role_assigned', userId: undefined }))
  })

  it('never revokes a role of its creator, nor a protected one', async () => {
    const revoke = () => REVOKE(call('rbac:write', 'rbac-assignment-delete', 'DELETE', '/api/v1/rbac/assignments/a1'), params('a1'))
    const row = { id: 'a1', roleId: 'role_tenant_viewer', scopeType: 'inherit', scopeTarget: null, user: { email: 'x@x' }, role: { name: 'Viewer', audience: null } }

    h.grantFindFirst.mockResolvedValue({ ...row, userId: 'creator' })
    const own = await revoke()
    expect(own.status).toBe(400)
    expect(await error(own)).toBe('An API token cannot revoke the roles of its creator')

    h.grantFindFirst.mockResolvedValue({ ...row, userId: 'u2', roleId: 'role_super_admin' })
    expect((await revoke()).status).toBe(404)
    expect(h.grantDeleteMany).not.toHaveBeenCalled()

    h.grantFindFirst.mockResolvedValue({ ...row, userId: 'u2' })
    expect((await revoke()).status).toBe(200)
    expect(h.grantDeleteMany).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })
})
