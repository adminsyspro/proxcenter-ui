import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  refuseAlert: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
}))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))
vi.mock('@/lib/incidents/alertVisibility', () => ({
  refuseInvisibleAlert: (...a: unknown[]) => m.refuseAlert(...a),
  visibleIncidents: async (v: unknown[]) => ({ views: v, hidden: 0 }),
  incidentViewResponse: async (v: unknown, _p: unknown, init?: ResponseInit) => NextResponse.json(v, init),
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', name: 'Ops', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.refuseAlert.mockResolvedValue(null)
  m.audit.mockResolvedValue('a1')
  m.orchestrator.mockResolvedValue({ id: 'i1', incidents: [], total: 0 })
})

describe('GET /incidents', () => {
  it('relays the filters and the list', async () => {
    m.orchestrator.mockResolvedValue({ incidents: [{ id: 'i1' }], total: 1 })
    const res = await callRoute(GET as any, { searchParams: { status: 'open', limit: '20' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ incidents: [{ id: 'i1' }], total: 1 })
    expect(m.orchestrator).toHaveBeenCalledWith('/incidents?status=open&limit=20')
  })

  it('404 for another tenant, no call to the orchestrator', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', email: 'a@x', tenantId: 'acme' } })
    expect((await callRoute(GET as any)).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('relays an upstream 400 code, and answers 503 when the orchestrator is out of reach', async () => {
    m.orchestrator.mockRejectedValueOnce(new Error('Orchestrator 400: {"error":"invalid body","code":"INVALID_BODY"}'))
    const bad = await callRoute(GET as any, { searchParams: { status: 'x' } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_body', code: 'INVALID_BODY' })

    m.orchestrator.mockRejectedValueOnce(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    expect((await callRoute(GET as any)).status).toBe(503)
  })
})

describe('POST /incidents', () => {
  it('replaces a forged created_by with the session author', async () => {
    const res = await callRoute(POST as any, { body: { title: 'T', alert_id: 'a1', created_by: 'forged' } })
    expect(res.status).toBe(201)
    expect(m.orchestrator).toHaveBeenCalledWith('/incidents', { method: 'POST', body: { title: 'T', alert_id: 'a1', created_by: 'Ops' } })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'alerts', resourceType: 'incident', action: 'create' }))
  })

  it('403 without alerts.manage', async () => {
    m.checkPermission.mockResolvedValue(NextResponse.json({ error: 'Permission denied' }, { status: 403 }))
    expect((await callRoute(POST as any, { body: { alert_id: 'a1' } })).status).toBe(403)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('400 invalid_body without an alert id', async () => {
    const res = await callRoute(POST as any, { body: { title: 'T' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })

  it('404 not_found for an alert outside the perimeter, nothing created', async () => {
    m.refuseAlert.mockResolvedValue(NextResponse.json({ error: 'not_found' }, { status: 404 }))
    expect((await callRoute(POST as any, { body: { alert_id: 'a1' } })).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('relays INCIDENT_NOT_FOUND for an unknown alert', async () => {
    m.orchestrator.mockRejectedValue(new Error('Orchestrator 404: {"error":"not found","code":"INCIDENT_NOT_FOUND"}'))
    const res = await callRoute(POST as any, { body: { alert_id: 'ghost' } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'incident_not_found', code: 'INCIDENT_NOT_FOUND' })
  })
})
