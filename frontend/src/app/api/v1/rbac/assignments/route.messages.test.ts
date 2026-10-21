import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  getServerSessionMock,
  hasPermissionMock,
  isSuperAdminMock,
  isProtectedMock,
  userFindUniqueMock,
  userTenantFindUniqueMock,
  tenantFindUniqueMock,
  roleFindUniqueMock,
  userRoleFindFirstMock,
  userRoleFindManyMock,
  userRoleCreateMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  isProtectedMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userTenantFindUniqueMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
  userRoleFindFirstMock: vi.fn(),
  userRoleFindManyMock: vi.fn(),
  userRoleCreateMock: vi.fn(),
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
    user: { findUnique: userFindUniqueMock },
    userTenant: { findUnique: userTenantFindUniqueMock },
    tenant: { findUnique: tenantFindUniqueMock, findMany: vi.fn().mockResolvedValue([]) },
    rbacRole: { findUnique: roleFindUniqueMock },
    rbacUserRole: { findFirst: userRoleFindFirstMock, findMany: userRoleFindManyMock, create: userRoleCreateMock },
  },
}))

import { GET, POST } from './route'

const VALID = { user_id: 'u1', role_id: 'role_x' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
  hasPermissionMock.mockResolvedValue(true)
  isSuperAdminMock.mockResolvedValue(true)
  isProtectedMock.mockResolvedValue(false)
  tenantFindUniqueMock.mockResolvedValue({ id: 'tenant-a', enabled: true })
  userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'u1@x' })
  userTenantFindUniqueMock.mockResolvedValue({ userId: 'u1' })
  roleFindUniqueMock.mockResolvedValue({ id: 'role_x', name: 'DB Admin', tenantId: null, permissions: [] })
  userRoleFindFirstMock.mockResolvedValue(null)
  userRoleFindManyMock.mockResolvedValue([])
  userRoleCreateMock.mockResolvedValue({ id: 'assign_1' })
})

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status)
  expect((await readJson<any>(res)).error).toBe(message)
}

describe('GET /api/v1/rbac/assignments messages', () => {
  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await callRoute(GET as any), 401, 'Unauthorized')
  })

  it('500 "Server error" when the query throws without a message', async () => {
    userRoleFindManyMock.mockRejectedValue(new Error(''))
    await expectError(await callRoute(GET as any), 500, 'Server error')
  })
})

describe('POST /api/v1/rbac/assignments messages', () => {
  const call = (body: Record<string, unknown>) => callRoute(POST as any, { body })

  it('201 on a valid assignment', async () => {
    const res = await call(VALID)
    expect(res.status).toBe(201)
  })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call(VALID), 401, 'Unauthorized')
  })

  it('403 "Admin rights required"', async () => {
    hasPermissionMock.mockResolvedValue(false)
    await expectError(await call(VALID), 403, 'Admin rights required')
  })

  it('400 when user_id or role_id is missing', async () => {
    await expectError(await call({ user_id: 'u1' }), 400, 'user_id and role_id are required')
  })

  it('404 "Tenant not found" for an unknown target tenant', async () => {
    tenantFindUniqueMock.mockResolvedValue(null)
    await expectError(await call({ ...VALID, tenant_id: 'tenant-zz' }), 404, 'Tenant not found')
  })

  it('400 when a provider-only role targets a tenant', async () => {
    await expectError(
      await call({ user_id: 'u1', role_id: 'operator', tenant_id: 'tenant-a' }),
      400,
      'This role can only be assigned in the provider tenant (default)',
    )
  })

  it('400 "You cannot change your own roles"', async () => {
    await expectError(await call({ user_id: 'admin', role_id: 'role_x' }), 400, 'You cannot change your own roles')
  })

  it('404 "Role not found" when a non-super-admin hands out a protected role', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await call({ user_id: 'u1', role_id: 'super_admin' }), 404, 'Role not found')
  })

  it('404 "User not found" when a non-super-admin targets a protected user', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    isProtectedMock.mockResolvedValue(true)
    await expectError(await call(VALID), 404, 'User not found')
  })

  it('404 "User not found" when the target user does not exist', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    await expectError(await call(VALID), 404, 'User not found')
  })

  it('400 when the target user is not a member of the tenant', async () => {
    isSuperAdminMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    userTenantFindUniqueMock.mockResolvedValue(null)
    await expectError(await call(VALID), 400, 'The user is not a member of this tenant')
  })

  it('404 "Role not found" when the role does not exist', async () => {
    roleFindUniqueMock.mockResolvedValue(null)
    await expectError(await call(VALID), 404, 'Role not found')
  })

  it('400 when the user already holds another role', async () => {
    userRoleFindFirstMock.mockResolvedValueOnce({ id: 'a0', role: { name: 'Viewer' } })
    await expectError(
      await call(VALID),
      400,
      'The user already has the role "Viewer". Remove it first or edit the existing assignment.',
    )
  })

  it('400 "This assignment already exists"', async () => {
    userRoleFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'a1' })
    await expectError(await call(VALID), 400, 'This assignment already exists')
  })

  it('500 "Server error" when create throws without a message', async () => {
    userRoleCreateMock.mockRejectedValue(new Error(''))
    await expectError(await call(VALID), 500, 'Server error')
  })
})
