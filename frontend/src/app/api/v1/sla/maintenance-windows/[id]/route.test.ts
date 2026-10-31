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

import { DELETE, PUT } from './route'

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

const W = (patch: object = {}) => ({
  id: 'w1', tenantId: 'default', scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, policyId: null,
  startsAt: new Date('2026-10-27T08:00:00Z'), endsAt: new Date('2026-10-27T10:00:00Z'), reason: 'Kernel', createdBy: 'ops@lab', createdAt: CREATED, ...patch,
})
const BODY = { scope: 'node', connectionId: 'c1', node: 'pve1', startsAt: '2026-10-28T08:00:00Z', endsAt: '2026-10-28T09:00:00Z', reason: 'Firmware' }

beforeEach(() => {
  resetCommon()
  m.db.slaMaintenanceWindow.findFirst.mockImplementation(async ({ where }: any) => (where.id === 'w1' ? W() : null))
  m.db.slaMaintenanceWindow.updateMany.mockResolvedValue({ count: 1 })
  m.db.slaMaintenanceWindow.deleteMany.mockResolvedValue({ count: 1 })
})

const put = (body: unknown, id = 'w1') => callRoute(PUT as any, { method: 'PUT', body: body as any, params: { id } })
const del = (id = 'w1') => callRoute(DELETE as any, { method: 'DELETE', params: { id } })

describe('PUT /sla/maintenance-windows/{id}', () => {
  it('replaces the window', async () => {
    const res = await put(BODY)
    expect(res.status).toBe(200)
    expect(m.db.slaMaintenanceWindow.updateMany).toHaveBeenCalledWith({ where: { id: 'w1' }, data: expect.objectContaining({
      startsAt: new Date('2026-10-28T08:00:00Z'), endsAt: new Date('2026-10-28T09:00:00Z'), reason: 'Firmware',
    }) })
  })

  it('endsAt <= startsAt and more than 31 days give 400', async () => {
    expect(await (await put({ ...BODY, endsAt: BODY.startsAt })).json()).toEqual({ error: 'invalid_window' })
    expect(await (await put({ ...BODY, endsAt: '2026-12-01T00:00:00Z' })).json()).toEqual({ error: 'invalid_window' })
    expect(m.db.slaMaintenanceWindow.updateMany).not.toHaveBeenCalled()
  })

  it('404 for a missing window or one outside the perimeter', async () => {
    expect((await put(BODY, 'w9')).status).toBe(404)
    asMsp()
    m.db.slaMaintenanceWindow.findFirst.mockResolvedValue(W({ connectionId: 'c2' }))
    expect((await put(BODY)).status).toBe(404)
    expect(m.db.slaMaintenanceWindow.updateMany).not.toHaveBeenCalled()
  })

  it('refuses moving the window outside the perimeter', async () => {
    asMsp()
    const res = await put({ ...BODY, connectionId: 'c2' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'target_out_of_scope' })
  })

  it('a vDC tenant gets a 404, before any write', async () => {
    asIaas()
    expect((await put(BODY)).status).toBe(404)
    expect(m.db.slaMaintenanceWindow.updateMany).not.toHaveBeenCalled()
  })

  it('403 without alerts.manage', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await put(BODY)).status).toBe(403)
  })
})

describe('DELETE /sla/maintenance-windows/{id}', () => {
  it('removes the window and audits it', async () => {
    expect((await del()).status).toBe(200)
    expect(m.db.slaMaintenanceWindow.deleteMany).toHaveBeenCalledWith({ where: { id: 'w1' } })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', resourceType: 'sla_maintenance_window', resourceId: 'w1' }))
  })

  it('404 for a missing window or one outside the perimeter', async () => {
    expect((await del('w9')).status).toBe(404)
    asMsp()
    m.db.slaMaintenanceWindow.findFirst.mockResolvedValue(W({ connectionId: 'c2' }))
    expect((await del()).status).toBe(404)
    expect(m.db.slaMaintenanceWindow.deleteMany).not.toHaveBeenCalled()
  })

  it('403 without sla_monitoring', async () => {
    m.hasFeature.mockResolvedValue(false)
    expect((await del()).status).toBe(403)
  })
})
