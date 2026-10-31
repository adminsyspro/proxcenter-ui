import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../__tests__/setup/route-test'

// The real alertVisibility helper runs; only isAlertVisibleToTenant is mocked,
// and refuses the alerts whose id starts with "hidden".
const m = vi.hoisted(() => ({
  session: vi.fn(),
  orchestrator: vi.fn(),
  getAlert: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => true }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1']),
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: async () => ({ kind: 'provider' }),
  maskingScope: () => null,
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: async () => null,
  getCurrentRbacInfraScope: async () => null,
}))
vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: async (a: { id: string }) => !a.id.startsWith('hidden'),
}))
vi.mock('@/lib/alerts/vdcVmids', () => ({ getVdcVmidsByConnection: async () => undefined }))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
  alertsApi: { getAlert: (...a: unknown[]) => m.getAlert(...a) },
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: async () => { markAuditExplicit(); return 'a1' } }
})

import { GET as getContext } from './[id]/context/route'
import { POST as postAlert } from './[id]/alerts/route'
import { DELETE as deleteAlert } from './[id]/alerts/[alertId]/route'
import { GET as getCandidates } from './[id]/candidates/route'
import { GET as getOne, PATCH } from './[id]/route'
import { GET as getList, POST as postIncident } from './route'
import { POST as forOutages } from './for-outages/route'
import { POST as closeIncident } from './[id]/close/route'

const mixed = () => ({
  id: 'i1',
  alert_count: 2,
  alerts: [
    { id: 'a1', type: 'node_down', connection_id: 'c1', resource: 'pve1' },
    { id: 'hidden1', type: 'vm_down', connection_id: 'c1', resource_id: 100 },
  ],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.getAlert.mockImplementation(async (id: string) => ({ data: { id } }))
  m.orchestrator.mockResolvedValue(mixed())
})

const ids = (alerts: { id: string }[]) => alerts.map(a => a.id)

describe('the perimeter of the caller on the incident views', () => {
  it('GET /incidents filters the alerts of every incident', async () => {
    m.orchestrator.mockResolvedValue({ incidents: [mixed(), mixed()], total: 2 })
    const body = await (await callRoute(getList as any)).json()
    expect(body.incidents.map((i: any) => [ids(i.alerts), i.alert_count])).toEqual([[['a1'], 1], [['a1'], 1]])
  })

  it('GET [id] filters the view', async () => {
    const body = await (await callRoute(getOne as any, { params: { id: 'i1' } })).json()
    expect(ids(body.alerts)).toEqual(['a1'])
    expect(body.alert_count).toBe(1)
  })

  it('PATCH [id] filters the answer', async () => {
    const res = await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'i1' }, body: { title: 'T' } })
    expect(ids((await res.json()).alerts)).toEqual(['a1'])
  })

  it('GET [id]/candidates filters the candidates', async () => {
    m.orchestrator.mockResolvedValue({ alerts: [{ id: 'a1' }, { id: 'hidden2' }] })
    const body = await (await callRoute(getCandidates as any, { params: { id: 'i1' } })).json()
    expect(ids(body.alerts)).toEqual(['a1'])
  })

  it('POST [id]/alerts is a 404 for an invisible alert, nothing attached', async () => {
    const res = await callRoute(postAlert as any, { params: { id: 'i1' }, body: { alert_id: 'hidden1' } })
    expect(res.status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('DELETE [id]/alerts/[alertId] is a 404 for an invisible alert, nothing detached', async () => {
    const res = await callRoute(deleteAlert as any, { method: 'DELETE', params: { id: 'i1', alertId: 'hidden1' } })
    expect(res.status).toBe(404)
    expect(m.orchestrator).not.toHaveBeenCalled()
    expect((await callRoute(deleteAlert as any, { method: 'DELETE', params: { id: 'i1', alertId: 'a1' } })).status).toBe(200)
  })

  it('GET [id]/context drops the outages of an invisible object', async () => {
    m.orchestrator.mockResolvedValue({
      incident: mixed(),
      outages: [
        { connection_id: 'c1', kind: 'node', node: 'pve1', vmid: 0, state: 'down', from: 'x', to: null },
        { connection_id: 'c1', kind: 'guest', node: '', vmid: 100, state: 'down', from: 'x', to: null },
      ],
    })
    const body = await (await callRoute(getContext as any, { params: { id: 'i1' } })).json()
    expect(ids(body.incident.alerts)).toEqual(['a1'])
    expect(body.outages.map((o: any) => o.kind)).toEqual(['node'])
  })
})

const hiddenOnly = () => ({
  id: 'i2',
  title: 'Secret post-mortem',
  alert_count: 1,
  alerts: [{ id: 'hidden9', type: 'node_down', connection_id: 'c2', resource: 'pve9' }],
})

describe('an incident without any visible alert', () => {
  it('is left out of the list, the total following', async () => {
    m.orchestrator.mockResolvedValue({ incidents: [mixed(), hiddenOnly(), hiddenOnly()], total: 7 })
    const body = await (await callRoute(getList as any)).json()
    expect(body.incidents.map((i: any) => i.id)).toEqual(['i1'])
    expect(body.total).toBe(5)
  })

  it('is a 404 not_found on GET [id]', async () => {
    m.orchestrator.mockResolvedValue(hiddenOnly())
    const res = await callRoute(getOne as any, { params: { id: 'i2' } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('is a 404 not_found on GET [id]/context', async () => {
    m.orchestrator.mockResolvedValue({ incident: hiddenOnly(), outages: [{ connection_id: 'c2', kind: 'node', node: 'pve9', vmid: 0 }] })
    const res = await callRoute(getContext as any, { params: { id: 'i2' } })
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('Secret')
  })

  it('is a null incident in for-outages, the visible match keeping its own', async () => {
    m.orchestrator.mockResolvedValue({
      matches: [
        { alerts: hiddenOnly().alerts, incident: { id: 'i2', title: 'Secret post-mortem' } },
        { alerts: mixed().alerts, incident: { id: 'i1', title: 'Open' } },
        { alerts: [], incident: null },
      ],
    })
    const res = await callRoute(forOutages as any, { body: { outages: [{ connection_id: 'c1', kind: 'node', node: 'pve1', vmid: 0, from: '2026-10-01T10:00:00Z', to: '2026-10-01T11:00:00Z' }] } })
    const body = await res.json()
    expect(body.matches.map((x: any) => [ids(x.alerts), x.incident?.id ?? null])).toEqual([[[], null], [['a1'], 'i1'], [[], null]])
    expect(JSON.stringify(body)).not.toContain('Secret')
  })

  it('answers a write with a 404 once the view has no visible alert', async () => {
    m.orchestrator.mockResolvedValue(hiddenOnly())
    expect((await callRoute(PATCH as any, { method: 'PATCH', params: { id: 'i2' }, body: { title: 'T' } })).status).toBe(404)
    expect((await callRoute(closeIncident as any, { method: 'POST', params: { id: 'i2' } })).status).toBe(404)
    expect((await callRoute(postIncident as any, { body: { alert_id: 'a1' } })).status).toBe(404)
  })
})
