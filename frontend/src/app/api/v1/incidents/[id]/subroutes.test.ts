import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  refuseAlert: vi.fn(),
  visible: vi.fn(),
  coverage: vi.fn(),
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
  visibleIncident: (...a: unknown[]) => m.visible(...a),
  incidentViewResponse: async (v: unknown, _p: unknown, init?: ResponseInit) => NextResponse.json(v, init),
}))
vi.mock('@/lib/incidents/slaCoverage', () => ({ slaCoverage: (...a: unknown[]) => m.coverage(...a) }))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import * as incident from './route'
import * as actions from './actions/route'
import * as action from './actions/[aid]/route'
import * as comments from './comments/route'
import * as coverage from './coverage/route'
import * as reopen from './reopen/route'
import * as attach from './alerts/route'
import * as byAlerts from '../by-alerts/route'

const forbidden = () => NextResponse.json({ error: 'Permission denied' }, { status: 403 })
const call = (handler: unknown, opts: Record<string, unknown> = {}) =>
  callRoute(handler as any, { params: { id: 'i1', aid: 'a1' }, ...opts } as any)
const lastCall = () => m.orchestrator.mock.calls.at(-1) as [string, { method?: string; body?: unknown }?]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', name: 'Ops', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.refuseAlert.mockResolvedValue(null)
  m.visible.mockImplementation(async (v: unknown) => v)
  m.coverage.mockResolvedValue({ inReport: true, outOfSla: [] })
  m.audit.mockResolvedValue('a1')
  m.orchestrator.mockResolvedValue({ id: 'i1', alerts: [{ id: 'al1' }] })
})

describe('/incidents/[id]', () => {
  it('reads, patches and deletes the incident by its id', async () => {
    expect((await call(incident.GET)).status).toBe(200)
    expect(lastCall()[0]).toBe('/incidents/i1')

    expect((await call(incident.PATCH, { method: 'PATCH', body: { title: 'Outage' } })).status).toBe(200)
    expect(lastCall()).toEqual(['/incidents/i1', expect.objectContaining({ method: 'PATCH', body: { title: 'Outage' } })])

    m.orchestrator.mockResolvedValue({ status: 'deleted' })
    expect(await (await call(incident.DELETE, { method: 'DELETE' })).json()).toEqual({ status: 'deleted' })
    expect(lastCall()).toEqual(['/incidents/i1', expect.objectContaining({ method: 'DELETE' })])
  })

  it('400 for a malformed patch, before the orchestrator', async () => {
    const res = await call(incident.PATCH, { method: 'PATCH', body: { title: '' } })
    expect(res.status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('delete needs admin.settings', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'admin.settings' ? forbidden() : null))
    expect((await call(incident.DELETE, { method: 'DELETE' })).status).toBe(403)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('404 for an unknown incident, relayed from the orchestrator', async () => {
    m.orchestrator.mockRejectedValue(new Error('Orchestrator 404: {"error":"incident not found","code":"INCIDENT_NOT_FOUND"}'))
    expect((await call(incident.GET)).status).toBe(404)
  })
})

describe('/incidents/[id]/actions', () => {
  it('adds an action, then ticks it as the session user, then deletes it', async () => {
    expect((await call(actions.POST, { method: 'POST', body: { text: 'Replace the PSU' } })).status).toBe(201)
    expect(lastCall()).toEqual(['/incidents/i1/actions', expect.objectContaining({ method: 'POST', body: { text: 'Replace the PSU' } })])

    expect((await call(action.PATCH, { method: 'PATCH', body: { done: true, by: 'forged' } })).status).toBe(200)
    expect(lastCall()).toEqual(['/incidents/i1/actions/a1', expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ done: true, by: 'Ops' }) })])

    expect((await call(action.DELETE, { method: 'DELETE' })).status).toBe(200)
    expect(lastCall()).toEqual(['/incidents/i1/actions/a1', expect.objectContaining({ method: 'DELETE' })])
  })

  it('400 for an empty action or a malformed patch', async () => {
    expect((await call(actions.POST, { method: 'POST', body: { text: '' } })).status).toBe(400)
    expect((await call(action.PATCH, { method: 'PATCH', body: { done: 'yes' } })).status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('403 without alerts.manage', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await call(actions.POST, { method: 'POST', body: { text: 'x' } })).status).toBe(403)
    expect((await call(action.DELETE, { method: 'DELETE' })).status).toBe(403)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})

describe('/incidents/[id]/comments', () => {
  it('adds a comment signed by the session, whatever the body says', async () => {
    const res = await call(comments.POST, { method: 'POST', body: { body: 'Rebooted', internal: true, author_id: 'x', author_name: 'X' } })
    expect(res.status).toBe(201)
    expect(lastCall()).toEqual(['/incidents/i1/comments', expect.objectContaining({
      method: 'POST', body: { body: 'Rebooted', internal: true, author_id: 'u1', author_name: 'Ops' },
    })])
  })

  it('400 for an empty comment', async () => {
    expect((await call(comments.POST, { method: 'POST', body: { body: '' } })).status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})

describe('/incidents/[id]/alerts', () => {
  it('attaches a visible alert as the session user', async () => {
    expect((await call(attach.POST, { method: 'POST', body: { alert_id: 'al2', by: 'forged' } })).status).toBe(200)
    expect(lastCall()).toEqual(['/incidents/i1/alerts', expect.objectContaining({ method: 'POST', body: { alert_id: 'al2', by: 'Ops' } })])
  })

  it('refuses an alert outside the perimeter, and a body without alert', async () => {
    m.refuseAlert.mockResolvedValue(NextResponse.json({ error: 'not_found' }, { status: 404 }))
    expect((await call(attach.POST, { method: 'POST', body: { alert_id: 'al9' } })).status).toBe(404)
    expect((await call(attach.POST, { method: 'POST', body: {} })).status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})

describe('/incidents/[id]/reopen', () => {
  it('reopens the incident', async () => {
    expect((await call(reopen.POST, { method: 'POST' })).status).toBe(200)
    expect(lastCall()).toEqual(['/incidents/i1/reopen', expect.objectContaining({ method: 'POST' })])
  })

  it('relays a conflict', async () => {
    m.orchestrator.mockRejectedValue(new Error('Orchestrator 409: {"error":"incident is not closed","code":"INCIDENT_CLOSED"}'))
    expect((await call(reopen.POST, { method: 'POST' })).status).toBe(409)
  })
})

describe('/incidents/[id]/coverage', () => {
  it('judges the coverage on the visible alerts', async () => {
    const res = await call(coverage.GET)
    expect(await res.json()).toEqual({ inReport: true, outOfSla: [] })
    expect(m.coverage).toHaveBeenCalledWith([{ id: 'al1' }])
  })

  it('404 when no alert of the incident is visible', async () => {
    m.visible.mockResolvedValue(null)
    expect((await call(coverage.GET)).status).toBe(404)
    expect(m.coverage).not.toHaveBeenCalled()
  })

  it('404 for another tenant', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', email: 'a@x', tenantId: 'acme' } })
    expect((await call(coverage.GET)).status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})

describe('/incidents/by-alerts', () => {
  it('asks the orchestrator for the listed ids only', async () => {
    m.orchestrator.mockResolvedValue({ incidents: { al1: { id: 'i1' } } })
    const res = await callRoute(byAlerts.GET as any, { searchParams: { ids: 'al1, al2,,' } })
    expect(await res.json()).toEqual({ incidents: { al1: { id: 'i1' } } })
    expect(lastCall()[0]).toMatch(/^\/incidents\/by-alerts\?ids=al1%2Cal2$/)
  })

  it('no id: an empty answer without the orchestrator; too many: 400', async () => {
    expect(await (await callRoute(byAlerts.GET as any, { searchParams: { ids: '' } })).json()).toEqual({ incidents: {} })
    const many = Array.from({ length: 501 }, (_, i) => `a${i}`).join(',')
    expect((await callRoute(byAlerts.GET as any, { searchParams: { ids: many } })).status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})
