import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  getServerSessionMock,
  userFindUniqueMock,
  roleFindManyMock,
  permFindManyMock,
  isSuperAdminMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  roleFindManyMock: vi.fn(),
  permFindManyMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    rbacUserRole: { findMany: roleFindManyMock, findFirst: vi.fn().mockResolvedValue(null) },
    rbacUserPermission: { findMany: permFindManyMock },
    rbacPermission: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
// Keep the real resolveEffectiveScopes; only stub the DB-backed helpers.
vi.mock('@/lib/rbac', async importActual => {
  const actual = await importActual<typeof import('@/lib/rbac')>()
  return { ...actual, isUserSuperAdmin: isSuperAdminMock, hasPermission: vi.fn() }
})

import { GET } from './route'

const inheritDbRole = {
  id: 'a1',
  scopeType: 'inherit',
  scopeTarget: null,
  expiresAt: null,
  role: {
    id: 'role_db',
    name: 'DB Admin',
    color: '#fff',
    widgetOverrides: null,
    defaultScopes: [{ scopeType: 'tag', scopeTarget: 'db' }],
    permissions: [{ permission: { id: 'p1', name: 'vm.view', category: 'vm' } }],
  },
}

describe('GET /api/v1/rbac/effective with role default scope (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'u1@x', role: 'viewer' })
    isSuperAdminMock.mockResolvedValue(false)
    permFindManyMock.mockResolvedValue([])
    roleFindManyMock.mockResolvedValue([inheritDbRole])
  })

  it('resolves an inherit assignment to the role default scope (no raw inherit leak)', async () => {
    const res = await callRoute(GET, { searchParams: { user_id: 'u1' } })
    const json: any = await readJson(res)

    expect(res.status).toBe(200)
    expect(json.data.permissions).toContain('vm.view')
    // scope_types reflects the resolved tag scope, never the raw sentinel
    expect(json.data.scope_types).toContain('tag')
    expect(json.data.scope_types).not.toContain('inherit')
    const detail = json.data.permission_details.find((d: any) => d.name === 'vm.view')
    expect(detail.scope_type).toBe('tag')
    expect(detail.scope_target).toBe('db')
  })

  it('keeps the permission on a resource-filtered call (inherit no longer drops it)', async () => {
    const res = await callRoute(GET, {
      searchParams: { user_id: 'u1', resource_type: 'vm', resource_id: 'c1:n1:qemu:100' },
    })
    const json: any = await readJson(res)

    expect(res.status).toBe(200)
    // Before the fix, checkScopeMatch('inherit', ...) hit default:false and
    // dropped vm.view whenever a resource filter was present.
    expect(json.data.permissions).toContain('vm.view')
  })
})
