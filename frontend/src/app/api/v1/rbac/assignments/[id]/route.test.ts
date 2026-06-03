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
    rbacUserRole: { findFirst: userRoleFindFirstMock, updateMany: userRoleUpdateManyMock },
    rbacRole: { findUnique: roleFindUniqueMock },
  },
}))

import { PATCH } from './route'

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
    const res = await callRoute(PATCH, {
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
    const res = await callRoute(PATCH, {
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
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'assign_1' },
      body: { scope_type: 'tag', scope_target: 'web' },
    })
    expect(res.status).toBe(200)
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeType).toBe('tag')
    expect(userRoleUpdateManyMock.mock.calls[0][0].data.scopeTarget).toBe('web')
  })
})
