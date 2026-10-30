import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  getServerSessionMock,
  checkPermissionMock,
  userFindUniqueMock,
  userTenantFindManyMock,
  rbacRoleFindUniqueMock,
  denyIfProtectedMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userTenantFindManyMock: vi.fn(),
  rbacRoleFindUniqueMock: vi.fn(),
  denyIfProtectedMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'hashed') }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    userTenant: { findMany: userTenantFindManyMock },
    rbacRole: { findUnique: rbacRoleFindUniqueMock },
  },
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_USERS: 'admin.users' },
  PROTECTED_ROLE_IDS: ['role_super_admin', 'role_provider_admin'],
  PROVIDER_ONLY_ROLE_IDS: ['role_operator'],
  isUserSuperAdmin: vi.fn(async () => false),
  isUserProtected: vi.fn(async () => false),
}))
vi.mock('@/lib/rbac/userTargetGuards', () => ({
  denyIfTargetIsProtectedAndCallerIsNot: denyIfProtectedMock,
  findUserInTenant: vi.fn(),
}))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: async () => 'default',
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  TenantMembershipError: class extends Error {},
}))

import { GET, PATCH, DELETE } from '../route'

const NOW = new Date('2026-10-01T00:00:00Z')
const USER = {
  id: 'u2', email: 'u2@x', name: 'U2', role: 'user', authProvider: 'credentials', enabled: true,
  lastLoginAt: null, createdAt: NOW, updatedAt: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
  checkPermissionMock.mockResolvedValue(null)
  denyIfProtectedMock.mockResolvedValue(null)
  userFindUniqueMock.mockResolvedValue(USER)
  userTenantFindManyMock.mockResolvedValue([{ tenantId: 'default' }, { tenantId: 'tenant-a' }])
  rbacRoleFindUniqueMock.mockResolvedValue({ id: 'role_operator' })
})

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status)
  expect((await readJson<any>(res)).error).toBe(message)
}

describe('GET /api/v1/users/[id] messages', () => {
  it('404 "User not found"', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    await expectError(await callRoute(GET as any, { params: { id: 'u2' } }), 404, 'User not found')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    userFindUniqueMock.mockRejectedValue({})
    await expectError(await callRoute(GET as any, { params: { id: 'u2' } }), 500, 'Server error')
  })
})

describe('PATCH /api/v1/users/[id] messages', () => {
  const call = (id: string, body: Record<string, unknown>) =>
    callRoute(PATCH as any, { method: 'PATCH', params: { id }, body })

  it('400 "You cannot disable your own account"', async () => {
    await expectError(await call('admin', { enabled: false }), 400, 'You cannot disable your own account')
  })

  it('404 "User not found"', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    await expectError(await call('u2', { name: 'x' }), 404, 'User not found')
  })

  it('403 when setting a local password on an SSO account', async () => {
    userFindUniqueMock.mockResolvedValue({ ...USER, authProvider: 'oidc' })
    await expectError(
      await call('u2', { password: 'longenoughpw' }),
      403,
      'The password is managed by the identity provider (OIDC/LDAP) and cannot be set here.',
    )
  })

  it('400 "Password must be at least 8 characters"', async () => {
    await expectError(await call('u2', { password: 'short' }), 400, 'Password must be at least 8 characters')
  })

  it('400 when a provider-only role would reach a tenant membership', async () => {
    await expectError(
      await call('u2', { roleId: 'role_operator' }),
      400,
      'This role can only be assigned in the provider tenant (default)',
    )
  })

  it('400 "No changes provided" on an empty body', async () => {
    await expectError(await call('u2', {}), 400, 'No changes provided')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    userFindUniqueMock.mockRejectedValue({})
    await expectError(await call('u2', { name: 'x' }), 500, 'Server error')
  })
})

describe('DELETE /api/v1/users/[id] messages', () => {
  const call = (id: string) => callRoute(DELETE as any, { method: 'DELETE', params: { id } })

  it('404 "User not found"', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    await expectError(await call('u2'), 404, 'User not found')
  })

  it('400 "You cannot delete your own account"', async () => {
    userFindUniqueMock.mockResolvedValue({ ...USER, id: 'admin' })
    await expectError(await call('admin'), 400, 'You cannot delete your own account')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    userFindUniqueMock.mockRejectedValue({})
    await expectError(await call('u2'), 500, 'Server error')
  })
})
