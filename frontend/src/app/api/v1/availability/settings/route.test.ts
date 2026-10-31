import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  audit: vi.fn(),
  count: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  getCurrentRbacInfraScope: vi.fn(),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { count: (...a: unknown[]) => m.count(...a) } } }))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))
vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: unknown[]) => m.getSetting(...a),
  setSetting: (...a: unknown[]) => m.setSetting(...a),
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import { GET, PUT } from './route'

let target: unknown

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  target = null
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.orchestrator.mockImplementation(async (_path: string, opts?: any) => (opts?.method === 'PUT'
    ? { retention_days: opts.body.retention_days ?? 400, connection_ids: opts.body.connection_ids ?? ['c1'] }
    : { retention_days: 400, connection_ids: ['c1'], connection_policies: { c1: ['Gold'] } }))
  // Every id asked for is a Proxmox VE connection unless a test says otherwise.
  m.count.mockImplementation(async ({ where }: any) => where.id.in.length)
  m.getSetting.mockImplementation(async () => target)
  m.setSetting.mockImplementation(async (_k: string, _t: string, v: unknown) => { target = v })
  m.audit.mockResolvedValue('a1')
})

const put = (body: unknown) => callRoute(PUT as any, { method: 'PUT', body: body as any })

describe('GET /availability/settings', () => {
  it('the orchestrator retention and the default target', async () => {
    const res = await callRoute(GET as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ retentionDays: 400, defaultTarget: 99.9, measuredConnections: ['c1'], policiesByConnection: { c1: ['Gold'] } })
    expect(m.orchestrator).toHaveBeenCalledWith('/availability/settings')
    expect(m.checkPermission).toHaveBeenCalledWith('admin.settings')
  })

  it('a non-provider tenant gets a 404, before the licence and the orchestrator', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', tenantId: 'acme' } })
    const res = await callRoute(GET as any)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    m.session.mockResolvedValue({ user: { id: 'u2' } })
    m.tenant.mockResolvedValue('acme')
    expect((await callRoute(GET as any)).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
    expect(m.hasFeature).not.toHaveBeenCalled()
  })

  it('403 without admin.settings or the licence', async () => {
    m.checkPermission.mockResolvedValue(NextResponse.json({ error: 'Permission denied' }, { status: 403 }))
    expect((await callRoute(GET as any)).status).toBe(403)
    m.checkPermission.mockResolvedValue(null)
    m.hasFeature.mockResolvedValue(false)
    expect((await callRoute(GET as any)).status).toBe(403)
  })

  it('503 when the orchestrator is out of reach', async () => {
    m.orchestrator.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const res = await callRoute(GET as any)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'orchestrator_unavailable' })
  })
})

describe('PUT /availability/settings', () => {
  it('relays the retention to the orchestrator and stores the default target', async () => {
    const res = await put({ retentionDays: 90, defaultTarget: 99.95 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ retentionDays: 90, defaultTarget: 99.95, measuredConnections: ['c1'], policiesByConnection: {} })
    expect(m.orchestrator).toHaveBeenCalledWith('/availability/settings', { method: 'PUT', body: { retention_days: 90 } })
    expect(m.setSetting).toHaveBeenCalledWith('sla.default_target', 'default', 99.95)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'settings', action: 'update', resourceType: 'availability_settings', status: 'success' }))
  })

  it('accepts either field alone', async () => {
    expect(await (await put({ defaultTarget: 99.5 })).json()).toEqual({ retentionDays: 400, defaultTarget: 99.5, measuredConnections: ['c1'], policiesByConnection: { c1: ['Gold'] } })
    expect(m.orchestrator).not.toHaveBeenCalledWith('/availability/settings', expect.objectContaining({ method: 'PUT' }))
    expect(await (await put({ retentionDays: 30 })).json()).toEqual({ retentionDays: 30, defaultTarget: 99.5, measuredConnections: ['c1'], policiesByConnection: {} })
  })

  it('relays the measured connections, once each, after checking they exist', async () => {
    const res = await put({ measuredConnections: ['c2', 'c3', 'c2'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ retentionDays: 400, defaultTarget: 99.9, measuredConnections: ['c2', 'c3'], policiesByConnection: {} })
    expect(m.count).toHaveBeenCalledWith({ where: { id: { in: ['c2', 'c3'] }, type: 'pve' } })
    expect(m.orchestrator).toHaveBeenCalledWith('/availability/settings', { method: 'PUT', body: { connection_ids: ['c2', 'c3'] } })

    // Unticking them all asks nothing of the database.
    m.count.mockClear()
    expect((await put({ measuredConnections: [] })).status).toBe(200)
    expect(m.count).not.toHaveBeenCalled()
  })

  it('refuses an unknown or malformed connection, without writing anything', async () => {
    m.count.mockResolvedValue(0)
    for (const measuredConnections of [['gone'], 'c1', [''], [42]]) {
      const res = await put({ measuredConnections })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_connections' })
    }
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('bounds of the retention: 30 to 1825 days', async () => {
    for (const retentionDays of [30, 1825]) expect((await put({ retentionDays })).status).toBe(200)
    for (const retentionDays of [29, 1826, 0, 400.5]) {
      const res = await put({ retentionDays })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_retention' })
    }
  })

  it('refuses a default target out of bounds, without writing anything', async () => {
    const res = await put({ retentionDays: 90, defaultTarget: 100 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_target' })
    expect(m.orchestrator).not.toHaveBeenCalled()
    expect(m.setSetting).not.toHaveBeenCalled()
  })

  it('an unreachable orchestrator leaves the default target as is', async () => {
    m.orchestrator.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    expect((await put({ retentionDays: 90, defaultTarget: 99.95 })).status).toBe(503)
    expect(m.setSetting).not.toHaveBeenCalled()
  })

  it('a non-provider tenant gets a 404', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', tenantId: 'acme' } })
    expect((await put({ retentionDays: 90 })).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})
