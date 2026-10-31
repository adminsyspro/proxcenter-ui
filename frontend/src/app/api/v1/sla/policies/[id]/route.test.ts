import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  rbacScope: vi.fn(),
  infra: vi.fn(),
  connections: vi.fn(),
  orchestrator: vi.fn(),
  pveFetch: vi.fn(),
  getSetting: vi.fn(),
  audit: vi.fn(),
  tenantPrismaFor: vi.fn(),
  db: {
    slaPolicy: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    slaMaintenanceWindow: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: () => m.tenant(),
  getTenantPrisma: (id: string) => { m.tenantPrismaFor(id); return m.db },
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a),
}))
vi.mock('@/lib/tenant/infraScope', async orig => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...a: unknown[]) => m.infra(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: (...a: unknown[]) => m.connections(...a) } } }))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/db/settings', () => ({ getSetting: (...a: unknown[]) => m.getSetting(...a), setSetting: vi.fn() }))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import { DELETE, GET, PUT } from './route'

const CREATED = new Date('2026-10-01T00:00:00Z')
const forbidden = () => NextResponse.json({ error: 'Permission denied' }, { status: 403 })

function asIaas() {
  m.session.mockResolvedValue({ user: { id: 'u2', email: 'acme@x', tenantId: 'acme' } })
  m.tenant.mockResolvedValue('acme')
  m.infra.mockResolvedValue({ kind: 'iaas', vdcScope: {
    connectionIds: new Set(['c1']), nodesByConnection: new Map([['c1', new Set(['pve1'])]]), poolsByConnection: new Map([['c1', new Set(['acme'])]]),
  } })
}

// A tenant that owns whole connections: c1 is its own, c2 is not.
function asMsp() {
  m.session.mockResolvedValue({ user: { id: 'u2', email: 'acme@x', tenantId: 'acme' } })
  m.tenant.mockResolvedValue('acme')
  m.infra.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['c1']) })
}

function resetCommon() {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.rbacScope.mockResolvedValue(null)
  m.infra.mockResolvedValue({ kind: 'provider' })
  m.connections.mockImplementation(async ({ where }: any) => ['c1', 'c2'].filter(id => !where.id || where.id.in.includes(id)).map(id => ({ id })))
  m.pveFetch.mockResolvedValue([
    { type: 'qemu', vmid: 100, node: 'pve1', pool: 'acme' },
    { type: 'qemu', vmid: 200, node: 'pve1', pool: 'other-tenant' },
  ])
  m.getSetting.mockResolvedValue(null)
  m.audit.mockResolvedValue('a1')
  m.db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops))
}

const ROW = {
  id: 'p1', tenantId: 'default', name: 'Prod', target: 99.9, guests: [{ connectionId: 'c1', vmid: 100 }], tags: [], pools: [], enabled: true,
  createdBy: 'ops@lab', createdAt: CREATED, updatedAt: CREATED,
}
const BODY = { name: 'Prod', target: 99.99, guests: [{ connectionId: 'c1', vmid: 100 }], enabled: false }
const RESULTS = [{ ref: { connection_id: 'c1', kind: 'guest', vmid: 100 }, availability: 99.5 }]
const SUMMARY = { availability: 99.5, below_target: 1 }

beforeEach(() => {
  resetCommon()
  m.orchestrator.mockResolvedValue({ results: RESULTS, summary: SUMMARY, policy: { id: 'p1', name: 'Prod', target: 99.9 } })
  m.db.slaPolicy.findFirst.mockImplementation(async ({ where }: any) => (where.id === 'p1' && !where.name ? ROW : null))
  m.db.slaPolicy.updateMany.mockResolvedValue({ count: 1 })
  m.db.slaPolicy.deleteMany.mockResolvedValue({ count: 1 })
  m.db.slaMaintenanceWindow.deleteMany.mockResolvedValue({ count: 2 })
})

const call = (handler: unknown, opts: Parameters<typeof callRoute>[1] = {}) => callRoute(handler as any, { params: { id: 'p1' }, ...opts })

describe('GET /sla/policies/{id}', () => {
  it('the policy with one result per guest, evaluated within the perimeter', async () => {
    const res = await call(GET, { searchParams: { period: '24h' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ policy: { id: 'p1', name: 'Prod' }, period: '24h', results: RESULTS, summary: SUMMARY })
    expect(body.policy).not.toHaveProperty('tenantId')
    const [path, opts] = m.orchestrator.mock.calls[0]
    expect(path).toBe('/availability/query')
    expect(opts.body).toMatchObject({ policy_id: 'p1', tenant_id: 'default', scope: null, slot_seconds: 60 })
  })

  it('names each guest server side: deleted guest and guest out of scope get null', async () => {
    m.pveFetch.mockResolvedValue([
      { type: 'qemu', vmid: 100, name: 'web-01', node: 'pve1', pool: 'acme' },
      { type: 'lxc', vmid: 200, name: 'secret-db', node: 'pve1', pool: 'other-tenant' },
      { type: 'qemu', vmid: 300, name: 'migrated', node: 'pve9', pool: 'acme' },
    ])
    m.orchestrator.mockResolvedValue({ summary: SUMMARY, policy: null, results: [
      { ref: { connection_id: 'c1', kind: 'guest', vmid: 100 }, availability: 99.5 },
      { ref: { connection_id: 'c1', kind: 'guest', vmid: 300 }, availability: 100 },
      { ref: { connection_id: 'c1', kind: 'guest', vmid: 200 }, availability: 100 },
      { ref: { connection_id: 'c1', kind: 'guest', vmid: 404 }, availability: null },
    ] })
    let body = await (await call(GET)).json()
    expect(body.results.map((r: any) => [r.ref.vmid, r.name, r.type])).toEqual([[100, 'web-01', 'qemu'], [300, 'migrated', 'qemu'], [200, 'secret-db', 'lxc'], [404, null, null]])
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/cluster/resources?type=vm')

    // A tenant of c1 only: the orchestrator mock answers a guest of c2 anyway;
    // it gets no name, and c2 is not read.
    asMsp()
    m.pveFetch.mockClear()
    m.orchestrator.mockResolvedValue({ summary: SUMMARY, policy: null, results: [
      { ref: { connection_id: 'c1', kind: 'guest', vmid: 100 }, availability: 99.5 },
      { ref: { connection_id: 'c2', kind: 'guest', vmid: 200 }, availability: 100 },
    ] })
    body = await (await call(GET)).json()
    expect(body.results.map((r: any) => [r.ref.vmid, r.name, r.type])).toEqual([[100, 'web-01', 'qemu'], [200, null, null]])
    expect(JSON.stringify(body)).not.toContain('secret-db')
    expect(m.pveFetch).not.toHaveBeenCalledWith({ id: 'c2' }, expect.anything())
  })

  it('404 for a policy of another tenant or a malformed id, without asking the orchestrator', async () => {
    expect((await call(GET, { params: { id: 'p9' } })).status).toBe(404)
    expect((await call(GET, { params: { id: '../x' } })).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('403 without sla_monitoring', async () => {
    m.hasFeature.mockResolvedValue(false)
    expect((await call(GET)).status).toBe(403)
  })
})

describe('PUT /sla/policies/{id}', () => {
  const put = (body: unknown, id = 'p1') => call(PUT, { method: 'PUT', body: body as any, params: { id } })

  it('replaces the policy in the tenant', async () => {
    const res = await put(BODY)
    expect(res.status).toBe(200)
    expect(m.db.slaPolicy.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: {
      name: 'Prod', target: 99.99, guests: [{ connectionId: 'c1', vmid: 100 }], tags: [], pools: [], enabled: false,
    } })
    expect(m.db.slaPolicy.findFirst).toHaveBeenCalledWith({ where: { name: 'Prod', NOT: { id: 'p1' } }, select: { id: true } })
  })

  it('refuses a name taken by another policy', async () => {
    m.db.slaPolicy.findFirst.mockImplementation(async ({ where }: any) => (where.name ? { id: 'p2' } : ROW))
    const res = await put(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'name_taken' })
    expect(m.db.slaPolicy.updateMany).not.toHaveBeenCalled()
  })

  it('keeps a guest it held on a connection no longer measured, and refuses a new one there', async () => {
    m.orchestrator.mockResolvedValue({ retention_days: 400, connection_ids: [] })
    m.db.slaPolicy.findFirst.mockImplementation(async ({ where }: any) =>
      (where.id === 'p1' && !where.name ? { ...ROW, guests: [{ connectionId: 'c1', vmid: 100 }] } : null))

    expect((await put(BODY)).status).toBe(200)
    expect(m.orchestrator).not.toHaveBeenCalled()

    const res = await put({ ...BODY, guests: [{ connectionId: 'c1', vmid: 100 }, { connectionId: 'c1', vmid: 101 }] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'connection_not_measured' })
    expect(m.orchestrator).toHaveBeenCalledWith('/availability/settings')
  })

  it('rejects guests on a connection the tenant does not own', async () => {
    asMsp()
    const res = await put({ ...BODY, guests: [{ connectionId: 'c2', vmid: 200 }] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'guest_out_of_scope' })
    expect(m.db.slaPolicy.updateMany).not.toHaveBeenCalled()
  })

  it('a vDC tenant gets a 404, before any write', async () => {
    asIaas()
    expect((await put(BODY)).status).toBe(404)
    expect(m.db.slaPolicy.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a target out of bounds, 404 for a missing policy', async () => {
    expect(await (await put({ ...BODY, target: 100 })).json()).toEqual({ error: 'invalid_target' })
    expect((await put(BODY, 'p9')).status).toBe(404)
  })

  it('403 without alerts.manage', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await put(BODY)).status).toBe(403)
    expect(m.db.slaPolicy.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /sla/policies/{id}', () => {
  const del = (id = 'p1') => call(DELETE, { method: 'DELETE', params: { id } })

  it('deletes the policy and its policy windows in one transaction', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(m.db.$transaction).toHaveBeenCalledTimes(1)
    expect(m.db.slaMaintenanceWindow.deleteMany).toHaveBeenCalledWith({ where: { scope: 'policy', policyId: 'p1' } })
    expect(m.db.slaPolicy.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1' } })
    expect(m.tenantPrismaFor).toHaveBeenCalledWith('default')
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', resourceType: 'sla_policy', resourceId: 'p1' }))
  })

  it('404 when nothing of the tenant was deleted', async () => {
    m.db.slaPolicy.deleteMany.mockResolvedValue({ count: 0 })
    expect((await del('p9')).status).toBe(404)
  })

  it('403 without sla_monitoring or alerts.manage', async () => {
    m.hasFeature.mockResolvedValue(false)
    expect((await del()).status).toBe(403)
    m.hasFeature.mockResolvedValue(true)
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await del()).status).toBe(403)
    expect(m.db.$transaction).not.toHaveBeenCalled()
  })
})
