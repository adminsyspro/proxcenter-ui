import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  providerAdmin: vi.fn(),
  isSuperAdmin: vi.fn(),
  isProtected: vi.fn(),
  audit: vi.fn(),
  sync: vi.fn(),
  customers: vi.fn(),
  reached: vi.fn(),
  userFindUnique: vi.fn(),
  roleFindUnique: vi.fn(),
  sdFindUnique: vi.fn(),
  sdFindMany: vi.fn(),
  sdCreate: vi.fn(),
  sdUpdate: vi.fn(),
  sdDelete: vi.fn(),
  urFindMany: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/audit', () => ({ audit: m.audit }))
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: m.providerAdmin }))
vi.mock('@/lib/rbac', () => ({
  isUserSuperAdmin: m.isSuperAdmin,
  isUserProtected: m.isProtected,
  PERMISSIONS: { ADMIN_RBAC: 'admin.rbac' },
}))
vi.mock('@/lib/rbac/serviceDesk', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac/serviceDesk')>()),
  syncServiceDeskAssignment: m.sync,
  listCustomerTenantIds: m.customers,
}))
vi.mock('@/lib/rbac/serviceDeskApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac/serviceDeskApi')>()),
  reachedTenants: m.reached,
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: m.userFindUnique },
    rbacRole: { findUnique: m.roleFindUnique },
    rbacUserRole: { findMany: m.urFindMany },
    rbacServiceDeskAssignment: { findUnique: m.sdFindUnique, findMany: m.sdFindMany, create: m.sdCreate, update: m.sdUpdate, delete: m.sdDelete },
  },
}))

import { GET, POST } from './route'
import { DELETE, PATCH } from './[id]/route'

const row = {
  id: 'sda_1',
  allTenants: true,
  tenantIds: [],
  grantedAt: new Date('2026-11-10T00:00:00Z'),
  expiresAt: null,
  user: { id: 'sd', email: 'sd@x', name: null },
  role: { id: 'r_sd', name: 'SD L1', color: '#000' },
  grantedBy: { email: 'admin@x' },
}
const sdRole = (over: Record<string, unknown> = {}) => ({
  id: 'r_sd', name: 'SD L1', audience: 'service_desk', publishAll: false,
  publications: [{ tenantId: 't1' }, { tenantId: 't2' }], permissions: [{ permissionId: 'vm.view' }], ...over,
})
const current = (over: Record<string, unknown> = {}) => ({
  id: 'sda_1', userId: 'sd', roleId: 'r_sd', allTenants: true, tenantIds: [], expiresAt: null,
  user: { email: 'sd@x' }, role: { name: 'SD L1', audience: 'service_desk', publishAll: false, publications: [{ tenantId: 't1' }, { tenantId: 't2' }], permissions: [] as { permissionId: string }[] }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'admin', email: 'admin@x' } })
  m.providerAdmin.mockResolvedValue(null)
  m.isSuperAdmin.mockResolvedValue(true)
  m.isProtected.mockResolvedValue(false)
  m.sync.mockResolvedValue({ added: ['t1', 't2'], removed: [] })
  m.customers.mockResolvedValue(['t1', 't2', 't3'])
  m.reached.mockResolvedValue(new Map([['sda_1', [{ id: 't1', name: 'One' }]]]))
  m.userFindUnique.mockResolvedValue({ id: 'sd', email: 'sd@x' })
  m.roleFindUnique.mockResolvedValue(sdRole())
  m.sdFindUnique.mockResolvedValue(null)
  m.sdFindMany.mockResolvedValue([row])
})

const post = (body: Record<string, unknown>) => callRoute(POST as any, { method: 'POST', body })

describe('service desk assignments: provider tenant only', () => {
  it('hands back the provider guard refusal on every verb', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    m.providerAdmin.mockResolvedValue(denied)
    expect((await callRoute(GET as any, { method: 'GET' })).status).toBe(403)
    m.providerAdmin.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(403)
    m.providerAdmin.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'sda_1' }, body: {} })).status).toBe(403)
    m.providerAdmin.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'sda_1' } })).status).toBe(403)
    expect(m.sdCreate).not.toHaveBeenCalled()
  })

  it('lists the assignments with the tenants they reach', async () => {
    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data[0]).toMatchObject({ id: 'sda_1', all_tenants: true, tenants: [{ id: 't1', name: 'One' }] })
  })
})

describe('POST /api/v1/rbac/service-desk-assignments', () => {
  it('creates the assignment, materialises it and audits the tenants reached', async () => {
    m.sdFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    const res = await post({ user_id: 'sd', role_id: 'r_sd', all_tenants: false, tenant_ids: ['t2', 't1'] })
    expect(res.status).toBe(201)
    expect(m.sdCreate.mock.calls[0][0].data).toMatchObject({ userId: 'sd', roleId: 'r_sd', allTenants: false, tenantIds: ['t1', 't2'], grantedById: 'admin', expiresAt: null })
    expect(m.sync).toHaveBeenCalledOnce()
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'rbac_service_desk_assigned', details: expect.objectContaining({ tenants: ['t1', 't2'] }) }))
  })

  it('needs a user and a role, and refuses a self grant', async () => {
    expect((await post({ user_id: 'sd' })).status).toBe(400)
    expect((await post({ user_id: 'admin', role_id: 'r_sd' })).status).toBe(400)
  })

  it('reads a missing user, or a protected one for a non super admin, as unknown', async () => {
    m.userFindUnique.mockResolvedValueOnce(null)
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(404)
    m.isSuperAdmin.mockResolvedValue(false)
    m.isProtected.mockResolvedValue(true)
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(404)
  })

  it('takes service desk roles only', async () => {
    m.roleFindUnique.mockResolvedValue(sdRole({ audience: 'tenant' }))
    expect(await readJson<any>(await post({ user_id: 'sd', role_id: 'r_sd' }))).toEqual({ error: 'Role not found' })
  })

  it('keeps NIC identity rights to a super admin', async () => {
    m.isSuperAdmin.mockResolvedValue(false)
    m.roleFindUnique.mockResolvedValue(sdRole({ permissions: [{ permissionId: 'vm.config.nic.mac' }] }))
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(403)
  })

  it('refuses a target outside the publication, a bad expiry and a duplicate', async () => {
    expect((await post({ user_id: 'sd', role_id: 'r_sd', all_tenants: false, tenant_ids: ['t3'] })).status).toBe(400)
    expect((await post({ user_id: 'sd', role_id: 'r_sd', expires_at: 'later' })).status).toBe(400)
    m.sdFindUnique.mockResolvedValueOnce({ id: 'sda_old' })
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(409)
    expect(m.sdCreate).not.toHaveBeenCalled()
  })
})

describe('PATCH and DELETE /api/v1/rbac/service-desk-assignments/[id]', () => {
  const patch = (body: Record<string, unknown>) => callRoute(PATCH as any, { method: 'PATCH', params: { id: 'sda_1' }, body })
  const del = () => callRoute(DELETE as any, { method: 'DELETE', params: { id: 'sda_1' } })

  it('narrows the target and re-syncs', async () => {
    m.sdFindUnique.mockResolvedValueOnce(current()).mockResolvedValueOnce(row)
    m.sync.mockResolvedValue({ added: [], removed: ['t2'] })
    const res = await patch({ all_tenants: false, tenant_ids: ['t1'] })
    expect(res.status).toBe(200)
    expect(m.sdUpdate).toHaveBeenCalledWith({ where: { id: 'sda_1' }, data: { allTenants: false, tenantIds: ['t1'], expiresAt: null } })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'rbac_service_desk_updated', details: expect.objectContaining({ tenants_removed: ['t2'] }) }))
  })

  it('changes the expiry alone, keeping the target', async () => {
    m.sdFindUnique.mockResolvedValueOnce(current({ allTenants: false, tenantIds: ['t1'] })).mockResolvedValueOnce(row)
    expect((await patch({ expires_at: '2027-01-01T00:00:00Z' })).status).toBe(200)
    expect(m.sdUpdate.mock.calls[0][0].data).toEqual({ allTenants: false, tenantIds: ['t1'], expiresAt: new Date('2027-01-01T00:00:00Z') })
  })

  it('refuses a bad target or expiry', async () => {
    m.sdFindUnique.mockResolvedValue(current())
    expect((await patch({ all_tenants: false, tenant_ids: [] })).status).toBe(400)
    expect((await patch({ expires_at: 'never' })).status).toBe(400)
    expect(m.sdUpdate).not.toHaveBeenCalled()
  })

  it('hides a missing assignment, the caller own one and a protected holder', async () => {
    m.sdFindUnique.mockResolvedValue(null)
    expect((await patch({})).status).toBe(404)
    m.sdFindUnique.mockResolvedValue(current({ userId: 'admin' }))
    expect((await del()).status).toBe(404)
    m.sdFindUnique.mockResolvedValue(current())
    m.isSuperAdmin.mockResolvedValue(false)
    m.isProtected.mockResolvedValue(true)
    expect((await del()).status).toBe(404)
    expect(m.sdDelete).not.toHaveBeenCalled()
  })

  it('revokes the assignment and every row it owned', async () => {
    m.sdFindUnique.mockResolvedValue(current())
    m.sync.mockResolvedValue({ added: [], removed: ['t1', 't2'] })
    const res = await del()
    expect(res.status).toBe(200)
    expect(m.sdDelete).toHaveBeenCalledWith({ where: { id: 'sda_1' } })
    expect(m.sync).toHaveBeenCalledWith('sda_1')
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'rbac_service_desk_revoked', details: { tenants_removed: ['t1', 't2'] } }))
  })

  it('keeps widening a NIC identity grant to a super admin, narrowing stays open', async () => {
    const nicRole = { name: 'SD NIC', audience: 'service_desk', publishAll: false, publications: [{ tenantId: 't1' }, { tenantId: 't2' }], permissions: [{ permissionId: 'vm.config.nic.mac' }] }
    m.isSuperAdmin.mockResolvedValue(false)
    m.urFindMany.mockResolvedValue([{ tenantId: 't1' }])
    m.sdFindUnique.mockResolvedValue(current({ allTenants: false, tenantIds: ['t1'], role: nicRole }))
    const widen = await patch({ all_tenants: true })
    expect(widen.status).toBe(403)
    expect((await readJson<any>(widen)).error).toBe('Only a super admin may widen a NIC identity grant')
    expect(m.sdUpdate).not.toHaveBeenCalled()

    m.sdFindUnique.mockReset()
    m.sdFindUnique.mockResolvedValueOnce(current({ allTenants: true, role: nicRole })).mockResolvedValueOnce(row)
    m.urFindMany.mockResolvedValue([{ tenantId: 't1' }, { tenantId: 't2' }])
    expect((await patch({ all_tenants: false, tenant_ids: ['t1'] })).status).toBe(200)

    m.sdFindUnique.mockReset()
    m.sdFindUnique.mockResolvedValueOnce(current({ allTenants: false, tenantIds: ['t1'], role: nicRole })).mockResolvedValueOnce(row)
    m.isSuperAdmin.mockResolvedValue(true)
    expect((await patch({ all_tenants: true })).status).toBe(200)
  })

  it('answers 401 without a session', async () => {
    m.session.mockResolvedValue(null)
    expect((await patch({})).status).toBe(401)
    expect((await del()).status).toBe(401)
    expect((await post({ user_id: 'sd', role_id: 'r_sd' })).status).toBe(401)
  })
})
