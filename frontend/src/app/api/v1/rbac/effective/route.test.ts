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

  it('a connection assignment opens its own resources, never those of a connection it is a prefix of', async () => {
    roleFindManyMock.mockResolvedValue([{ ...inheritDbRole, scopeType: 'connection', scopeTarget: 'conn-a', role: { ...inheritDbRole.role, defaultScopes: null } }])
    const permissionsOn = async (resource_id: string) => {
      const res = await callRoute(GET, { searchParams: { user_id: 'u1', resource_type: 'vm', resource_id } })
      expect(res.status).toBe(200)
      return ((await readJson(res)) as any).data.permissions
    }

    expect(await permissionsOn('conn-a:pve1:qemu:100')).toContain('vm.view')
    expect(await permissionsOn('conn-ab:pve1:qemu:100')).not.toContain('vm.view')
  })
})

describe('GET /api/v1/rbac/effective English messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'u1@x', role: 'viewer' })
  })

  async function expectError(res: Response, status: number, message: string) {
    expect(res.status).toBe(status)
    expect(((await readJson(res)) as any).error).toBe(message)
  }

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await callRoute(GET), 401, 'Unauthorized')
  })

  it('403 when reading another user without admin.rbac', async () => {
    await expectError(await callRoute(GET, { searchParams: { user_id: 'u2' } }), 403, "Not allowed to view other users' permissions")
  })

  it('404 "User not found"', async () => {
    userFindUniqueMock.mockResolvedValue(null)
    await expectError(await callRoute(GET), 404, 'User not found')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    userFindUniqueMock.mockRejectedValue(new Error(''))
    await expectError(await callRoute(GET), 500, 'Server error')
  })
})
