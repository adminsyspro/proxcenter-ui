import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// scope-validation is intentionally NOT mocked: we want to exercise the route's
// real use of validateAssignmentScope (issue #383).
const {
  getServerSessionMock,
  hasPermissionMock,
  isSuperAdminMock,
  isProtectedMock,
  userFindUniqueMock,
  roleFindUniqueMock,
  userRoleFindFirstMock,
  userRoleCreateMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  isProtectedMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  roleFindUniqueMock: vi.fn(),
  userRoleFindFirstMock: vi.fn(),
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
  PROTECTED_ROLE_IDS: [],
  PROVIDER_ONLY_ROLE_IDS: [],
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    userTenant: { findUnique: vi.fn() },
    rbacRole: { findUnique: roleFindUniqueMock },
    rbacUserRole: { findFirst: userRoleFindFirstMock, create: userRoleCreateMock },
  },
}))

import { POST } from './route'

describe('POST /api/v1/rbac/assignments scope handling (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
    hasPermissionMock.mockResolvedValue(true)
    isSuperAdminMock.mockResolvedValue(true) // caller + target both super: skips membership check
    isProtectedMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'u1@x' })
    roleFindUniqueMock.mockResolvedValue({ id: 'role_x', name: 'DB Admin', tenantId: null })
    userRoleFindFirstMock.mockResolvedValue(null) // no existing role, no duplicate assignment
    userRoleCreateMock.mockResolvedValue({ id: 'assign_1' })
  })

  it('rejects a scoped assignment with no target', async () => {
    const res = await callRoute(POST, { body: { user_id: 'u1', role_id: 'role_x', scope_type: 'node' } })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.error).toMatch(/scope_target/i)
    expect(userRoleCreateMock).not.toHaveBeenCalled()
  })

  it('defaults a manual assignment to "inherit" when no scope_type is given', async () => {
    const res = await callRoute(POST, { body: { user_id: 'u1', role_id: 'role_x' } })
    expect(res.status).toBe(201)
    expect(userRoleCreateMock).toHaveBeenCalled()
    expect(userRoleCreateMock.mock.calls[0][0].data.scopeType).toBe('inherit')
    expect(userRoleCreateMock.mock.calls[0][0].data.scopeTarget).toBeNull()
  })

  it('keeps an explicit scope (tag) and its target', async () => {
    const res = await callRoute(POST, {
      body: { user_id: 'u1', role_id: 'role_x', scope_type: 'tag', scope_target: 'db' },
    })
    expect(res.status).toBe(201)
    expect(userRoleCreateMock.mock.calls[0][0].data.scopeType).toBe('tag')
    expect(userRoleCreateMock.mock.calls[0][0].data.scopeTarget).toBe('db')
  })
})
