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

import { GET, POST } from './route'

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

const W = (id: string, patch: object = {}) => ({
  id, tenantId: 'default', scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, policyId: null,
  startsAt: new Date('2026-10-27T08:00:00Z'), endsAt: new Date('2026-10-27T10:00:00Z'), reason: 'Kernel', createdBy: 'ops@lab', createdAt: CREATED, ...patch,
})
const BODY = { scope: 'node', connectionId: 'c1', node: 'pve1', startsAt: '2026-10-27T08:00:00Z', endsAt: '2026-10-27T10:00:00Z', reason: 'Kernel' }

beforeEach(() => {
  resetCommon()
  m.db.slaMaintenanceWindow.findMany.mockResolvedValue([
    W('w1'), W('w2', { node: 'pve2' }), W('w3', { scope: 'guest', connectionId: 'c2', node: null, vmid: 300 }), W('w4', { scope: 'policy', connectionId: null, node: null, policyId: 'p1' }),
  ])
  m.db.slaMaintenanceWindow.create.mockImplementation(async ({ data }: any) => ({ ...W('w9'), ...data }))
  m.db.slaPolicy.findFirst.mockImplementation(async ({ where }: any) => (where.id === 'p1' ? { id: 'p1' } : null))
})

const post = (body: unknown) => callRoute(POST as any, { body: body as any })

describe('GET /sla/maintenance-windows', () => {
  it('the provider sees every window of the tenant', async () => {
    const body = await (await callRoute(GET as any)).json()
    expect(body).toMatchObject({ total: 4, page: 1, pageSize: 20 })
    expect(body.data[0]).toMatchObject({ id: 'w1', startsAt: '2026-10-27T08:00:00.000Z' })
    expect(body.data[0]).not.toHaveProperty('tenantId')
  })

  it('a tenant sees only the windows of its connections', async () => {
    asMsp()
    const body = await (await callRoute(GET as any)).json()
    expect(body.data.map((w: any) => w.id)).toEqual(['w1', 'w2', 'w4'])
    expect(m.tenantPrismaFor).toHaveBeenCalledWith('acme')
  })

  it('a vDC tenant gets a 404', async () => {
    asIaas()
    expect((await callRoute(GET as any)).status).toBe(404)
    expect(m.db.slaMaintenanceWindow.findMany).not.toHaveBeenCalled()
  })

  it('403 without sla_monitoring', async () => {
    m.hasFeature.mockResolvedValue(false)
    expect((await callRoute(GET as any)).status).toBe(403)
  })

  it('400 invalid_page for a page out of 1..10000', async () => {
    for (const page of ['1e20', '-1']) {
      const res = await callRoute(GET as any, { searchParams: { page } })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_page' })
    }
    expect(m.db.slaMaintenanceWindow.findMany).not.toHaveBeenCalled()
  })
})

describe('POST /sla/maintenance-windows', () => {
  it('declares a window with its author', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(201)
    expect(m.db.slaMaintenanceWindow.create).toHaveBeenCalledWith({ data: {
      scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, policyId: null,
      startsAt: new Date('2026-10-27T08:00:00Z'), endsAt: new Date('2026-10-27T10:00:00Z'), reason: 'Kernel', createdBy: 'ops@lab',
    } })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'alerts', action: 'create', resourceType: 'sla_maintenance_window' }))
  })

  it('endsAt <= startsAt gives 400', async () => {
    for (const endsAt of [BODY.startsAt, '2026-10-27T07:59:59Z']) {
      const res = await post({ ...BODY, endsAt })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_window' })
    }
    expect(m.db.slaMaintenanceWindow.create).not.toHaveBeenCalled()
  })

  it('more than 31 days gives 400', async () => {
    const res = await post({ ...BODY, endsAt: '2026-11-27T08:00:01Z' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_window' })
  })

  it('refuses a target outside the perimeter, without a name', async () => {
    asMsp()
    let res = await post({ ...BODY, connectionId: 'c2' })
    expect(await res.json()).toEqual({ error: 'target_out_of_scope' })
    res = await post({ ...BODY, scope: 'connection', connectionId: 'c2' })
    expect(await res.json()).toEqual({ error: 'target_out_of_scope' })
    res = await post({ ...BODY, scope: 'guest', connectionId: 'c2', vmid: 200 })
    expect(await res.json()).toEqual({ error: 'guest_out_of_scope' })
    res = await post({ ...BODY, startsAt: '2026-10-28T08:00', endsAt: '2026-10-28T10:00' })
    expect(await res.json()).toEqual({ error: 'invalid_window' })
    res = await post({ ...BODY, scope: 'policy', policyId: 'p9' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'target_out_of_scope' })
    expect(m.db.slaMaintenanceWindow.create).not.toHaveBeenCalled()
    expect((await post({ ...BODY, scope: 'guest', vmid: 200 })).status).toBe(201)
    expect((await post({ ...BODY, scope: 'connection' })).status).toBe(201)
    expect((await post({ ...BODY, scope: 'policy', policyId: 'p1' })).status).toBe(201)
  })

  it('403 without sla_monitoring or alerts.manage', async () => {
    m.hasFeature.mockResolvedValue(false)
    expect((await post(BODY)).status).toBe(403)
    m.hasFeature.mockResolvedValue(true)
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await post(BODY)).status).toBe(403)
    expect(m.db.slaMaintenanceWindow.create).not.toHaveBeenCalled()
  })
})
