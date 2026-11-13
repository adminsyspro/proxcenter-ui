// Who reads role assignments and role holders (roadmap#223): admin.users or
// admin.rbac; anyone else reads its own assignments only and no holders.
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  reader: vi.fn(),
  canRead: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  roleFindUnique: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/api-tokens/routeGuard', () => ({ withPublicApiGuard: (_entryId: string, handler: unknown) => handler }))
vi.mock('@/lib/auth/actingUser', () => ({
  authorizeAdminRead: () => m.reader(),
  getActingSession: () => m.session(),
}))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default', DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/tenant/constants', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({
  hasPermission: vi.fn(),
  isUserSuperAdmin: async () => false,
  isUserProtected: async () => false,
  PROTECTED_ROLE_IDS: ['role_super_admin', 'role_provider_admin'],
  PROVIDER_ONLY_ROLE_IDS: [],
  PERMISSIONS: { ADMIN_RBAC_VIEW: 'admin.rbac.view' },
}))
vi.mock('@/lib/rbac/assignmentReadAccess', () => ({ canReadRoleAssignments: (...a: unknown[]) => m.canRead(...a) }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findMany: (...a: unknown[]) => m.findMany(...a), findFirst: (...a: unknown[]) => m.findFirst(...a) },
    rbacRole: { findUnique: (...a: unknown[]) => m.roleFindUnique(...a) },
    tenant: { findMany: async () => [] },
  },
}))

import { GET as listAssignments } from './route'
import { GET as getAssignment } from './[id]/route'
import { GET as getRole } from '../roles/[id]/route'

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'ur1',
  userId: 'other',
  roleId: 'role_tenant_admin',
  tenantId: 'msp',
  scopeType: 'inherit',
  scopeTarget: null,
  grantedById: 'admin',
  grantedAt: new Date('2026-11-01T00:00:00Z'),
  expiresAt: null,
  user: { id: 'other', email: 'other@x', name: 'Other' },
  role: { id: 'role_tenant_admin', name: 'Tenant Admin', color: '#000', isSystem: true, audience: null },
  grantedBy: { email: 'admin@x' },
  ...over,
})

const role = {
  id: 'role_viewer',
  name: 'Viewer',
  description: null,
  isSystem: true,
  color: '#fff',
  widgetOverrides: null,
  defaultScopes: null,
  tenantId: null,
  audience: null,
  publishAll: false,
  publications: [],
  createdAt: new Date('2026-06-03T00:00:00Z'),
  updatedAt: new Date('2026-06-03T00:00:00Z'),
  permissions: [{ permission: { id: 'vm.view', name: 'vm.view', category: 'vm', description: '', isDangerous: false } }],
  userRoles: [assignment({ roleId: 'role_viewer' })],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'me', email: 'me@x' } })
  m.reader.mockResolvedValue({ denied: null, userId: 'me', isSuperAdmin: false })
  m.findMany.mockResolvedValue([])
  m.roleFindUnique.mockResolvedValue(role)
})

describe('GET /api/v1/rbac/assignments', () => {
  it('lists every assignment for a caller with admin.users or admin.rbac', async () => {
    m.canRead.mockResolvedValue(true)
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([assignment()])
    const res = await callRoute(listAssignments as any)
    expect(res.status).toBe(200)
    expect(m.canRead).toHaveBeenCalledWith('me', 'default')
    expect(m.findMany.mock.calls[1][0].where.userId).toBeUndefined()
    expect(((await readJson(res)) as any).data).toHaveLength(1)
  })

  it('narrows any other caller to its own assignments', async () => {
    m.canRead.mockResolvedValue(false)
    m.findMany.mockResolvedValueOnce([{ userId: 'boss' }]).mockResolvedValueOnce([])
    const res = await callRoute(listAssignments as any)
    expect(res.status).toBe(200)
    expect(m.findMany.mock.calls[1][0].where.userId).toEqual({ equals: 'me', notIn: ['boss'] })
  })

  it("answers an empty list when such a caller asks for someone else's assignments", async () => {
    m.canRead.mockResolvedValue(false)
    const res = await callRoute(listAssignments as any, { url: 'http://localhost/api/v1/rbac/assignments?user_id=other' })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [], meta: { total: 0 } })
    expect(m.findMany).not.toHaveBeenCalled()
  })

  it('keeps its own user_id filter for such a caller', async () => {
    m.canRead.mockResolvedValue(false)
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([assignment({ userId: 'me' })])
    const res = await callRoute(listAssignments as any, { url: 'http://localhost/api/v1/rbac/assignments?user_id=me' })
    expect(res.status).toBe(200)
    expect(m.findMany.mock.calls[1][0].where.userId).toBe('me')
  })
})

describe('a token (it reached the route through admin.rbac.view)', () => {
  beforeEach(() => m.reader.mockResolvedValue({ denied: null, userId: undefined, isSuperAdmin: false }))

  it('lists every assignment', async () => {
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([assignment()])
    const res = await callRoute(listAssignments as any)
    expect(res.status).toBe(200)
    expect(m.canRead).not.toHaveBeenCalled()
    expect(m.findMany.mock.calls[1][0].where.userId).toEqual(undefined)
  })

  it("reads someone else's assignment and a role's holders", async () => {
    m.findFirst.mockResolvedValue(assignment())
    expect((await callRoute(getAssignment as any, { params: { id: 'ur1' } })).status).toBe(200)
    const json: any = await readJson(await callRoute(getRole as any, { params: { id: 'role_viewer' } }))
    expect(json.data.users).toHaveLength(1)
    expect(m.canRead).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/rbac/assignments/[id]', () => {
  it("is a 404 for someone else's assignment without admin.users or admin.rbac", async () => {
    m.canRead.mockResolvedValue(false)
    m.findFirst.mockResolvedValue(assignment())
    const res = await callRoute(getAssignment as any, { params: { id: 'ur1' } })
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'Assignment not found' })
  })

  it("reads the caller's own assignment without them", async () => {
    m.canRead.mockResolvedValue(false)
    m.findFirst.mockResolvedValue(assignment({ userId: 'me' }))
    const res = await callRoute(getAssignment as any, { params: { id: 'ur1' } })
    expect(res.status).toBe(200)
  })

  it('reads any assignment with them', async () => {
    m.canRead.mockResolvedValue(true)
    m.findFirst.mockResolvedValue(assignment())
    const res = await callRoute(getAssignment as any, { params: { id: 'ur1' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data.user_email).toBe('other@x')
  })
})

describe('GET /api/v1/rbac/roles/[id]', () => {
  it('lists the holders of a role with admin.users or admin.rbac', async () => {
    m.canRead.mockResolvedValue(true)
    const res = await callRoute(getRole as any, { params: { id: 'role_viewer' } })
    const json: any = await readJson(res)
    expect(res.status).toBe(200)
    expect(json.data.users).toEqual([expect.objectContaining({ email: 'other@x', granted_by_email: 'admin@x' })])
  })

  it('keeps the role and its permissions but no holder without them', async () => {
    m.canRead.mockResolvedValue(false)
    const res = await callRoute(getRole as any, { params: { id: 'role_viewer' } })
    const json: any = await readJson(res)
    expect(res.status).toBe(200)
    expect(json.data.users).toEqual([])
    expect(json.data.permissions).toHaveLength(1)
    expect(json.data.name).toBe('Viewer')
  })
})
