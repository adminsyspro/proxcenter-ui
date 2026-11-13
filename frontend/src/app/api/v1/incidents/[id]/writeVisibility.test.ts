// Every route that writes to one incident tests its visibility BEFORE the
// write: an incident none of whose alerts the caller may see is a 404 and the
// orchestrator receives no write (roadmap#223).
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  visible: vi.fn(),
  rbacScope: vi.fn(),
  refuseAlert: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => true }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a),
}))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))
vi.mock('@/lib/incidents/alertVisibility', () => ({
  visibleIncident: (...a: unknown[]) => m.visible(...a),
  refuseInvisibleAlert: (...a: unknown[]) => m.refuseAlert(...a),
  incidentViewResponse: async (v: unknown) => NextResponse.json(v),
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import * as incident from './route'
import * as actions from './actions/route'
import * as action from './actions/[aid]/route'
import * as comments from './comments/route'
import * as comment from './comments/[cid]/route'
import * as close from './close/route'
import * as reopen from './reopen/route'
import * as attach from './alerts/route'
import * as detach from './alerts/[alertId]/route'

const VIEW = { id: 'i1', alerts: [{ id: 'al1' }], comments: [{ id: 'c1', author_id: 'u1' }] }

const WRITES: [string, unknown, Record<string, unknown>][] = [
  ['PATCH /incidents/[id]', incident.PATCH, { method: 'PATCH', body: { title: 'x' } }],
  ['DELETE /incidents/[id]', incident.DELETE, { method: 'DELETE' }],
  ['POST /actions', actions.POST, { method: 'POST', body: { text: 'x' } }],
  ['PATCH /actions/[aid]', action.PATCH, { method: 'PATCH', body: { done: true } }],
  ['DELETE /actions/[aid]', action.DELETE, { method: 'DELETE' }],
  ['POST /comments', comments.POST, { method: 'POST', body: { body: 'x' } }],
  ['PATCH /comments/[cid]', comment.PATCH, { method: 'PATCH', body: { body: 'x' } }],
  ['DELETE /comments/[cid]', comment.DELETE, { method: 'DELETE' }],
  ['POST /close', close.POST, { method: 'POST' }],
  ['POST /reopen', reopen.POST, { method: 'POST' }],
  ['POST /alerts', attach.POST, { method: 'POST', body: { alert_id: 'al2' } }],
  ['DELETE /alerts/[alertId]', detach.DELETE, { method: 'DELETE' }],
]

const call = (handler: unknown, opts: Record<string, unknown>) =>
  callRoute(handler as any, { params: { id: 'i1', aid: 'a1', cid: 'c1', alertId: 'al1' }, ...opts } as any)
const writes = () => m.orchestrator.mock.calls.filter(c => (c[1] as { method?: string } | undefined)?.method)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', name: 'Ops', email: 'ops@lab', tenantId: 'default' } })
  m.checkPermission.mockResolvedValue(null)
  m.refuseAlert.mockResolvedValue(null)
  m.rbacScope.mockResolvedValue({ connectionIds: new Set(['c1']) })
  m.audit.mockResolvedValue('a1')
  m.orchestrator.mockImplementation(async (_path: string, opts?: { method?: string }) => (opts?.method ? { ...VIEW, status: 'ok' } : VIEW))
})

describe('incident writes outside the caller perimeter', () => {
  it.each(WRITES)('%s is a 404 and writes nothing', async (_label, handler, opts) => {
    m.visible.mockResolvedValue(null)
    const res = await call(handler, opts)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(writes()).toEqual([])
    expect(m.orchestrator).toHaveBeenCalledWith('/incidents/i1')
  })

  it.each(WRITES)('%s writes once the incident is visible', async (_label, handler, opts) => {
    m.visible.mockImplementation(async (v: unknown) => v)
    const res = await call(handler, opts)
    expect(res.status).toBeLessThan(300)
    expect(writes()).toHaveLength(1)
    expect(m.orchestrator.mock.calls[0]).toEqual(['/incidents/i1'])
  })

  it('judges a write on the alerts the caller manages, a delete on the ones it reads', async () => {
    m.visible.mockImplementation(async (v: unknown) => v)
    await call(incident.PATCH, { method: 'PATCH', body: { title: 'x' } })
    expect(m.visible.mock.calls[0]).toEqual([VIEW, 'alerts.manage'])
    m.visible.mockClear()
    await call(incident.DELETE, { method: 'DELETE' })
    expect(m.visible.mock.calls[0]).toEqual([VIEW, 'alerts.view'])
  })

  it('lets a caller nothing restricts write as before, without the visibility test', async () => {
    m.rbacScope.mockResolvedValue(null)
    m.visible.mockResolvedValue(null)
    const res = await call(incident.DELETE, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(m.rbacScope).toHaveBeenCalledWith('alerts.view')
    expect(m.visible).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(1)
  })
})
