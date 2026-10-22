import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  getServerSessionMock,
  hasPermissionMock,
  isSuperAdminMock,
  isProtectedMock,
  userRoleFindFirstMock,
  userRoleUpdateManyMock,
  userRoleDeleteManyMock,
  roleFindUniqueMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  isProtectedMock: vi.fn(),
  userRoleFindFirstMock: vi.fn(),
  userRoleUpdateManyMock: vi.fn(),
  userRoleDeleteManyMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default', DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({
  hasPermission: hasPermissionMock,
  isUserSuperAdmin: isSuperAdminMock,
  isUserProtected: isProtectedMock,
  PROTECTED_ROLE_IDS: ['super_admin'],
  PROVIDER_ONLY_ROLE_IDS: ['operator'],
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findFirst: userRoleFindFirstMock, updateMany: userRoleUpdateManyMock, deleteMany: userRoleDeleteManyMock },
    rbacRole: { findUnique: roleFindUniqueMock },
  },
}))

import { GET, DELETE, PATCH } from './route'

const PARAMS = { id: 'assign_1' }

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'assign_1',
  userId: 'u1',
  roleId: 'role_x',
  scopeType: 'global',
  scopeTarget: null,
  tenantId: 'default',
  grantedById: null,
  grantedAt: new Date('2026-10-01T00:00:00Z'),
  expiresAt: null,
  user: { id: 'u1', email: 'u1@x', name: null },
  role: { id: 'role_x', name: 'DB Admin', color: '#fff', permissions: [] },
  grantedBy: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
  hasPermissionMock.mockResolvedValue(true)
  isSuperAdminMock.mockResolvedValue(true)
  isProtectedMock.mockResolvedValue(false)
  userRoleFindFirstMock.mockResolvedValue(assignment())
  userRoleUpdateManyMock.mockResolvedValue({ count: 1 })
  userRoleDeleteManyMock.mockResolvedValue({ count: 1 })
  roleFindUniqueMock.mockResolvedValue({ id: 'role_y', permissions: [] })
})

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status)
  expect((await readJson<any>(res)).error).toBe(message)
}

describe('GET /api/v1/rbac/assignments/[id] messages', () => {
  it('200 returns the assignment', async () => {
    const res = await callRoute(GET as any, { params: PARAMS })
    expect(res.status).toBe(200)
  })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await callRoute(GET as any, { params: PARAMS }), 401, 'Unauthorized')
  })

  it('404 "Assignment not found" when the row is missing', async () => {
    userRoleFindFirstMock.mockResolvedValue(null)
    await expectError(await callRoute(GET as any, { params: PARAMS }), 404, 'Assignment not found')
  })

  it('404 "Assignment not found" when a non-super-admin reads a protected assignment', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    userRoleFindFirstMock.mockResolvedValue(assignment({ roleId: 'super_admin' }))
    await expectError(await callRoute(GET as any, { params: PARAMS }), 404, 'Assignment not found')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    userRoleFindFirstMock.mockRejectedValue(new Error(''))
    await expectError(await callRoute(GET as any, { params: PARAMS }), 500, 'Server error')
  })
})

describe('DELETE /api/v1/rbac/assignments/[id] messages', () => {
  const call = () => callRoute(DELETE as any, { method: 'DELETE', params: PARAMS })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call(), 401, 'Unauthorized')
  })

  it('403 "Admin rights required"', async () => {
    hasPermissionMock.mockResolvedValue(false)
    await expectError(await call(), 403, 'Admin rights required')
  })

  it('404 "Assignment not found"', async () => {
    userRoleFindFirstMock.mockResolvedValue(null)
    await expectError(await call(), 404, 'Assignment not found')
  })

  it('400 "You cannot revoke your own roles"', async () => {
    userRoleFindFirstMock.mockResolvedValue(assignment({ userId: 'admin' }))
    await expectError(await call(), 400, 'You cannot revoke your own roles')
  })

  it('500 "Server error" when the delete throws without a message', async () => {
    userRoleDeleteManyMock.mockRejectedValue(new Error(''))
    await expectError(await call(), 500, 'Server error')
  })
})

describe('PATCH /api/v1/rbac/assignments/[id] messages', () => {
  const call = (body: Record<string, unknown>) => callRoute(PATCH as any, { method: 'PATCH', params: PARAMS, body })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call({ role_id: 'role_y' }), 401, 'Unauthorized')
  })

  it('403 "Admin rights required"', async () => {
    hasPermissionMock.mockResolvedValue(false)
    await expectError(await call({ role_id: 'role_y' }), 403, 'Admin rights required')
  })

  it('404 "Assignment not found" when the row is missing', async () => {
    userRoleFindFirstMock.mockResolvedValue(null)
    await expectError(await call({ role_id: 'role_y' }), 404, 'Assignment not found')
  })

  it('400 "You cannot change your own roles"', async () => {
    userRoleFindFirstMock.mockResolvedValue(assignment({ userId: 'admin' }))
    await expectError(await call({ role_id: 'role_y' }), 400, 'You cannot change your own roles')
  })

  it('404 "Role not found" when a non-super-admin promotes to a protected role', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await call({ role_id: 'super_admin' }), 404, 'Role not found')
  })

  it('400 when a provider-only role is assigned in a tenant', async () => {
    userRoleFindFirstMock.mockResolvedValue(assignment({ tenantId: 'tenant-a' }))
    await expectError(
      await call({ role_id: 'operator' }),
      400,
      'This role can only be assigned in the provider tenant (default)',
    )
  })

  it('404 "Role not found" when the target role does not exist', async () => {
    roleFindUniqueMock.mockResolvedValue(null)
    await expectError(await call({ role_id: 'role_missing' }), 404, 'Role not found')
  })

  it('400 "No fields to update" on an empty body', async () => {
    await expectError(await call({}), 400, 'No fields to update')
  })

  it('404 "Assignment not found" when the row vanishes after the update', async () => {
    userRoleFindFirstMock.mockResolvedValueOnce(assignment()).mockResolvedValueOnce(null)
    await expectError(await call({ role_id: 'role_y' }), 404, 'Assignment not found')
  })

  it('500 "Server error" when the update throws without a message', async () => {
    userRoleUpdateManyMock.mockRejectedValue(new Error(''))
    await expectError(await call({ role_id: 'role_y' }), 500, 'Server error')
  })
})
