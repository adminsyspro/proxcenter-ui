// Provider role catalogue (ui#1336): audience, publication and permission
// ceiling on the role routes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  isSuperAdmin: vi.fn(),
  tenantId: vi.fn(),
  audit: vi.fn(),
  refuse: vi.fn(),
  unknownTenant: vi.fn(),
  revoked: vi.fn(),
  syncRole: vi.fn(),
  roleFindFirst: vi.fn(),
  roleFindUnique: vi.fn(),
  roleFindMany: vi.fn(),
  roleCreate: vi.fn((a: any) => a),
  pubCreateMany: vi.fn((a: any) => a),
  permCreateMany: vi.fn((a: any) => a),
  groupBy: vi.fn(),
  sdCount: vi.fn(),
  urCount: vi.fn(),
  tx: vi.fn(),
  txClient: {
    rbacRole: { update: vi.fn() },
    rbacRolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
    rbacRolePublication: { deleteMany: vi.fn(), createMany: vi.fn() },
    rbacUserRole: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock("@/lib/auth/actingUser", async () => (await import("@/__tests__/fixtures/actingUserFromNextAuth")).actingUserFromNextAuth())
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: m.tenantId }))
vi.mock('@/lib/audit', () => ({ audit: m.audit }))
vi.mock('@/lib/rbac/assignmentReadAccess', () => ({ canReadRoleAssignments: async () => true }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ADMIN_RBAC_VIEW: 'admin.rbac.view' }, isUserSuperAdmin: m.isSuperAdmin, PROTECTED_ROLE_IDS: [] }))
vi.mock('@/lib/rbac/catalogueGuards', () => ({ refuseOverCeiling: m.refuse, findUnknownTenant: m.unknownTenant }))
vi.mock('@/lib/rbac/serviceDesk', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac/serviceDesk')>()),
  assignmentsRevokedByPublication: m.revoked,
  syncServiceDeskForRole: m.syncRole,
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacRole: { findFirst: m.roleFindFirst, findUnique: m.roleFindUnique, findMany: m.roleFindMany, create: m.roleCreate },
    rbacRolePermission: { createMany: m.permCreateMany },
    rbacRolePublication: { createMany: m.pubCreateMany },
    rbacUserRole: { groupBy: m.groupBy, count: m.urCount },
    rbacServiceDeskAssignment: { count: m.sdCount },
    $transaction: m.tx,
  },
}))

import { GET, POST } from './route'
import { DELETE, GET as GET_ONE, PATCH } from './[id]/route'

const dbRole = (over: Record<string, unknown> = {}) => ({
  id: 'role_c',
  name: 'Catalogue',
  description: null,
  isSystem: false,
  color: '#fff',
  widgetOverrides: null,
  defaultScopes: null,
  tenantId: 'default',
  audience: 'tenant',
  publishAll: false,
  publications: [{ tenantId: 't1' }],
  createdAt: new Date('2026-11-10T00:00:00Z'),
  updatedAt: new Date('2026-11-10T00:00:00Z'),
  permissions: [] as any[],
  userRoles: [] as any[],
  _count: { userRoles: 1 },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'admin', email: 'a@x' } })
  m.isSuperAdmin.mockResolvedValue(true)
  m.tenantId.mockResolvedValue('default')
  m.refuse.mockResolvedValue(null)
  m.unknownTenant.mockResolvedValue(null)
  m.revoked.mockResolvedValue([])
  m.syncRole.mockResolvedValue({ added: [], removed: [] })
  m.roleFindFirst.mockResolvedValue(null)
  m.roleFindUnique.mockResolvedValue(dbRole())
  m.roleFindMany.mockResolvedValue([dbRole()])
  m.groupBy.mockResolvedValue([{ roleId: 'role_c', _count: { _all: 7 } }])
  m.sdCount.mockResolvedValue(0)
  m.urCount.mockResolvedValue(0)
  m.txClient.rbacUserRole.findMany.mockResolvedValue([])
  m.tx.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(m.txClient) : arg))
})

describe('GET /api/v1/rbac/roles', () => {
  it('shows the provider the publication and the cross-tenant holder count', async () => {
    const body = await readJson<any>(await callRoute(GET as any, { method: 'GET' }))
    expect(body.data[0]).toMatchObject({ audience: 'tenant', publish_all: false, published_tenants: ['t1'], user_count: 7 })
    expect(m.roleFindMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2)
  })

  it('offers a customer tenant the catalogue roles published to it, without where else', async () => {
    m.tenantId.mockResolvedValue('t1')
    const body = await readJson<any>(await callRoute(GET as any, { method: 'GET' }))
    expect(m.roleFindMany.mock.calls[0][0].where.AND[0].OR[2]).toEqual({
      audience: 'tenant',
      OR: [{ publishAll: true }, { publications: { some: { tenantId: 't1' } } }],
    })
    expect(body.data[0]).toMatchObject({ audience: 'tenant', published_tenants: null, user_count: 1 })
    expect(m.groupBy).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/rbac/roles with an audience', () => {
  const post = (body: Record<string, unknown>) => callRoute(POST as any, { method: 'POST', body: { name: 'SD', permissions: ['vm.view'], ...body } })

  it('creates a published role with its publication', async () => {
    const res = await post({ audience: 'tenant', published_tenants: ['t1'] })
    expect(res.status).toBe(201)
    expect(m.roleCreate.mock.calls[0][0].data).toMatchObject({ audience: 'tenant', publishAll: false, tenantId: 'default' })
    expect(m.pubCreateMany.mock.calls[0][0].data).toEqual([{ roleId: expect.stringMatching(/^role_/), tenantId: 't1' }])
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ audience: 'tenant', published_tenants: ['t1'] }) }))
  })

  it('refuses a bad publication, a customer tenant author, an unknown tenant and the ceiling', async () => {
    expect((await post({ audience: 'nope' })).status).toBe(400)
    m.tenantId.mockResolvedValue('t1')
    expect(await readJson<any>(await post({ audience: 'provider' }))).toEqual({ error: 'Catalogue roles are created from the provider tenant' })
    m.tenantId.mockResolvedValue('default')
    m.unknownTenant.mockResolvedValueOnce('ghost')
    expect(await readJson<any>(await post({ audience: 'tenant', published_tenants: ['ghost'] }))).toEqual({ error: 'Unknown tenant: ghost' })
    m.refuse.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PERMISSION_CEILING' }), { status: 400 }))
    expect((await post({ audience: 'tenant', publish_all: true })).status).toBe(400)
    expect(m.roleCreate).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/rbac/roles/[id] from a customer tenant', () => {
  it('reads a catalogue role offered to the tenant, not one published elsewhere', async () => {
    m.tenantId.mockResolvedValue('t1')
    const res = await callRoute(GET_ONE as any, { method: 'GET', params: { id: 'role_c' } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.published_tenants).toBeNull()
    m.tenantId.mockResolvedValue('t2')
    expect((await callRoute(GET_ONE as any, { method: 'GET', params: { id: 'role_c' } })).status).toBe(404)
  })
})

describe('PATCH /api/v1/rbac/roles/[id] publication', () => {
  const patch = (body: Record<string, unknown>) => callRoute(PATCH as any, { method: 'PATCH', params: { id: 'role_c' }, body })

  it('asks for confirmation before revoking, then revokes the ordinary rows and re-syncs the service desk', async () => {
    m.revoked.mockResolvedValue([{ tenantId: 't1', tenantName: 'One', count: 2 }])
    const ask = await patch({ published_tenants: ['t2'] })
    expect(ask.status).toBe(409)
    expect(await readJson<any>(ask)).toMatchObject({ code: 'REVOKE_CONFIRMATION_REQUIRED', revoked: [{ tenant_id: 't1', tenant_name: 'One', count: 2 }] })
    expect(m.tx).not.toHaveBeenCalled()

    m.txClient.rbacUserRole.findMany.mockResolvedValue([{ id: 'assign_1' }, { id: 'sd_a_t1' }])
    const ok = await patch({ published_tenants: ['t2'], confirm_revoke: true })
    expect(ok.status).toBe(200)
    expect(m.txClient.rbacRolePublication.createMany).toHaveBeenCalledWith({ data: [{ roleId: 'role_c', tenantId: 't2' }], skipDuplicates: true })
    expect(m.txClient.rbacUserRole.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['assign_1'] } } })
    expect(m.syncRole).toHaveBeenCalledWith('role_c')
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac_role_publication_changed',
      details: expect.objectContaining({ tenants_added: ['t2'], tenants_removed: ['t1'] }),
    }))
  })

  it('keeps everything when the role is published to all', async () => {
    await patch({ publish_all: true })
    expect(m.revoked).toHaveBeenCalledWith('role_c', 'all')
  })

  it('refuses a publication on a system or customer role, and a bad payload', async () => {
    m.roleFindUnique.mockResolvedValue(dbRole({ tenantId: null, isSystem: true }))
    expect((await patch({ audience: 'tenant' })).status).toBe(400)
    m.roleFindUnique.mockResolvedValue(dbRole())
    expect((await patch({ audience: 'nope' })).status).toBe(400)
    m.unknownTenant.mockResolvedValueOnce('ghost')
    expect((await patch({ published_tenants: ['ghost'] })).status).toBe(400)
  })

  it('never turns a catalogue role back into a single-tenant one', async () => {
    expect(await readJson<any>(await patch({ audience: null }))).toEqual({ error: 'A catalogue role cannot go back to a single-tenant role' })
  })

  it('keeps a service desk role while assignments hold it', async () => {
    m.roleFindUnique.mockResolvedValue(dbRole({ audience: 'service_desk' }))
    m.sdCount.mockResolvedValue(2)
    expect(await readJson<any>(await patch({ audience: 'tenant' }))).toEqual({ error: 'This role has 2 service desk assignment(s). Remove them first.' })
  })

  it('applies the ceiling to the permissions the role keeps or receives', async () => {
    m.roleFindUnique.mockResolvedValue(dbRole({ audience: null, publications: [], permissions: [{ permissionId: 'admin.tenants' }] }))
    m.refuse.mockResolvedValueOnce(new Response('{}', { status: 400 }))
    expect((await patch({ audience: 'tenant', publish_all: true })).status).toBe(400)
    expect(m.refuse).toHaveBeenCalledWith('tenant', ['admin.tenants'], expect.anything(), 'Catalogue')
  })

  it('converts a legacy role to the provider audience, confirming the SSO tenants it loses', async () => {
    m.roleFindUnique.mockResolvedValue(dbRole({ audience: null, publications: [{ tenantId: 't1' }] }))
    await patch({ audience: 'provider' })
    expect(m.revoked).toHaveBeenCalledWith('role_c', new Set())
  })
})

describe('DELETE /api/v1/rbac/roles/[id]', () => {
  it('counts the service desk assignments among the holders', async () => {
    m.sdCount.mockResolvedValue(1)
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'role_c' } })
    expect(res.status).toBe(400)
  })
})
