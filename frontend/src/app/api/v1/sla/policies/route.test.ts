import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

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
    slaPolicy: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
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

import { GET, POST } from './route'

const CREATED = new Date('2026-10-01T00:00:00Z')
const row = (id: string, name: string) => ({
  id, tenantId: 'default', name, target: 99.9, guests: [], tags: ['prod'], pools: [], enabled: true,
  createdBy: 'ops@lab', createdAt: CREATED, updatedAt: CREATED,
})
const SUMMARY = { up_seconds: 100, down_seconds: 0, unobserved_seconds: 0, availability: 100, coverage: 100, below_target: 0, budget: { allowed_seconds: 1, used_seconds: 0, remaining_seconds: 1 } }
const BODY = { name: 'Prod web', target: 99.95, guests: [{ connectionId: 'c1', vmid: 100 }], tags: ['web'] }
const forbidden = () => NextResponse.json({ error: 'Permission denied' }, { status: 403 })

function asIaas() {
  m.session.mockResolvedValue({ user: { id: 'u2', email: 'acme@x', tenantId: 'acme' } })
  m.tenant.mockResolvedValue('acme')
  m.infra.mockResolvedValue({ kind: 'iaas', vdcScope: {
    connectionIds: new Set(['c1']), nodesByConnection: new Map([['c1', new Set(['pve1'])]]), poolsByConnection: new Map([['c1', new Set(['acme'])]]),
  } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.rbacScope.mockResolvedValue(null)
  m.infra.mockResolvedValue({ kind: 'provider' })
  m.connections.mockImplementation(async ({ where }: any) => ['c1', 'c2'].filter(id => !where.id || where.id.in.includes(id)).map(id => ({ id })))
  m.orchestrator.mockImplementation(async (_path: string, opts: any) => ({ results: [{}, {}], summary: { ...SUMMARY, policy: opts.body.policy_id } }))
  m.pveFetch.mockResolvedValue([
    { type: 'qemu', vmid: 100, node: 'pve1', pool: 'acme' },
    { type: 'qemu', vmid: 200, node: 'pve1', pool: 'other-tenant' },
    { type: 'qemu', vmid: 300, node: 'pve9', pool: 'acme' },
  ])
  m.getSetting.mockResolvedValue(99.5)
  m.audit.mockResolvedValue('a1')
  m.db.slaPolicy.count.mockResolvedValue(2)
  m.db.slaPolicy.findMany.mockResolvedValue([row('p1', 'Prod'), row('p2', 'Stage')])
  m.db.slaPolicy.findFirst.mockResolvedValue(null)
  m.db.slaPolicy.create.mockImplementation(async ({ data }: any) => ({ ...row('p3', data.name), ...data }))
})

describe('GET /sla/policies', () => {
  it('one page with a summary per policy, one query each, in the tenant', async () => {
    const res = await callRoute(GET as any, { searchParams: { period: '7d', page: '2' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(m.tenantPrismaFor).toHaveBeenCalledWith('default')
    expect(m.db.slaPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }))
    expect(body).toMatchObject({ total: 2, page: 2, pageSize: 20, period: '7d', defaultTarget: 99.5 })
    expect(body.data.map((p: any) => [p.id, p.summary.policy, p.guestCount])).toEqual([['p1', 'p1', 2], ['p2', 'p2', 2]])
    expect(body.data[0]).not.toHaveProperty('tenantId')
    const bodies = m.orchestrator.mock.calls.map(([path, opts]: any) => [path, opts.body.policy_id, opts.body.slot_seconds, opts.body.scope])
    expect(bodies).toEqual([['/availability/query', 'p1', 600, null], ['/availability/query', 'p2', 600, null]])
  })

  it('a policy deleted meanwhile keeps its row without a summary', async () => {
    m.orchestrator.mockImplementation(async (_p: string, opts: any) => {
      if (opts.body.policy_id === 'p2') throw new Error('Orchestrator 404: {"error":"policy_not_found"}')
      return { results: [], summary: SUMMARY }
    })
    const body = await (await callRoute(GET as any)).json()
    expect(body.data[1]).toMatchObject({ id: 'p2', summary: null, guestCount: 0 })
  })

  it('400 invalid_page for a page out of 1..10000', async () => {
    for (const page of ['1e20', '-1', '0', '10001', '2.5']) {
      const res = await callRoute(GET as any, { searchParams: { page } })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_page' })
    }
    expect(m.db.slaPolicy.findMany).not.toHaveBeenCalled()
    expect((await callRoute(GET as any, { searchParams: { page: '10000' } })).status).toBe(200)
  })

  it('503 when the orchestrator is out of reach', async () => {
    m.orchestrator.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const res = await callRoute(GET as any)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'orchestrator_unavailable' })
  })

  it('403 without sla_monitoring, before any read', async () => {
    m.hasFeature.mockResolvedValue(false)
    const res = await callRoute(GET as any)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'feature_required', feature: 'sla_monitoring' })
    expect(m.db.slaPolicy.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /sla/policies?fields=names', () => {
  it('lists every policy of the tenant by name without calling the orchestrator', async () => {
    const res = await callRoute(GET as any, { searchParams: { fields: 'names' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [{ id: 'p1', name: 'Prod', enabled: true }, { id: 'p2', name: 'Stage', enabled: true }] })
    expect(m.tenantPrismaFor).toHaveBeenCalledWith('default')
    expect(m.db.slaPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 1000 }))
    expect(m.db.slaPolicy.findMany.mock.calls[0][0]).not.toHaveProperty('skip')
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('reads the policies of the caller tenant only', async () => {
    asIaas()
    await callRoute(GET as any, { searchParams: { fields: 'names' } })
    expect(m.tenantPrismaFor).toHaveBeenCalledWith('acme')
    expect(m.tenantPrismaFor).not.toHaveBeenCalledWith('default')
  })

  it('403 without sla_monitoring, before any read', async () => {
    m.hasFeature.mockResolvedValue(false)
    const res = await callRoute(GET as any, { searchParams: { fields: 'names' } })
    expect(res.status).toBe(403)
    expect(m.db.slaPolicy.findMany).not.toHaveBeenCalled()
  })

  it('400 invalid_fields for another value', async () => {
    const res = await callRoute(GET as any, { searchParams: { fields: 'all' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_fields' })
  })
})

describe('POST /sla/policies', () => {
  const post = (body: unknown) => callRoute(POST as any, { body: body as any })

  it('creates the policy in the tenant, with its author, and audits it', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(201)
    expect(m.db.slaPolicy.create).toHaveBeenCalledWith({ data: {
      name: 'Prod web', target: 99.95, guests: [{ connectionId: 'c1', vmid: 100 }], tags: ['web'], pools: [], enabled: true, createdBy: 'ops@lab',
    } })
    expect((await res.json()).policy).toMatchObject({ name: 'Prod web', target: 99.95 })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'alerts', action: 'create', resourceType: 'sla_policy', status: 'success' }))
  })

  it('rejects guests outside the vDC scope', async () => {
    asIaas()
    const res = await post({ ...BODY, guests: [{ connectionId: 'c1', vmid: 200 }] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ error: 'guest_out_of_scope' })
    expect(JSON.stringify(body)).not.toMatch(/other-tenant|pve1|200/)
    expect(m.db.slaPolicy.create).not.toHaveBeenCalled()
  })

  it('accepts a vDC guest of the tenant pools, and refuses another connection or pool', async () => {
    asIaas()
    expect((await post(BODY)).status).toBe(201)
    // In the vDC pool on a node outside the vDC: accepted, the pool decides.
    expect((await post({ ...BODY, name: 'Moved', guests: [{ connectionId: 'c1', vmid: 300 }] })).status).toBe(201)
    expect((await post({ ...BODY, guests: [{ connectionId: 'c2', vmid: 100 }] })).status).toBe(400)
    expect(await (await post({ ...BODY, guests: [], pools: ['other-tenant'] })).json()).toEqual({ error: 'guest_out_of_scope' })
  })

  it('refuses a duplicate name, also when two writes race', async () => {
    m.db.slaPolicy.findFirst.mockResolvedValue({ id: 'p1' })
    let res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'name_taken' })
    expect(m.db.slaPolicy.findFirst).toHaveBeenCalledWith({ where: { name: 'Prod web' }, select: { id: true } })
    m.db.slaPolicy.findFirst.mockResolvedValue(null)
    m.db.slaPolicy.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    res = await post(BODY)
    expect(res.status).toBe(409)
  })

  it('refuses a target out of bounds, an empty or long name', async () => {
    for (const target of [89.9, 100, 99.9999]) {
      const res = await post({ ...BODY, target })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_target' })
    }
    expect(await (await post({ ...BODY, name: ' ' })).json()).toEqual({ error: 'invalid_name' })
    expect(await (await post({ ...BODY, name: 'x'.repeat(121) })).json()).toEqual({ error: 'invalid_name' })
    expect(await (await callRoute(POST as any, { body: '{not json', headers: { 'content-type': 'application/json' } })).json()).toEqual({ error: 'invalid_body' })
  })

  it('403 without sla_monitoring', async () => {
    m.hasFeature.mockResolvedValue(false)
    const res = await post(BODY)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'feature_required', feature: 'sla_monitoring' })
    expect(m.db.slaPolicy.create).not.toHaveBeenCalled()
  })

  it('403 without alerts.manage', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    const res = await post(BODY)
    expect(res.status).toBe(403)
    expect(m.checkPermission).toHaveBeenCalledWith('alerts.manage')
    expect(m.db.slaPolicy.create).not.toHaveBeenCalled()
  })
})
