import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  visible: vi.fn(),
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
vi.mock('@/lib/incidents/alertVisibility', async orig => ({
  ...(await orig<typeof import('@/lib/incidents/alertVisibility')>()),
  visibleAlertFilter: async () => (a: { id: string }) => m.visible(a),
}))

import { POST } from './route'

const outage = { connection_id: 'c1', kind: 'guest', node: '', vmid: 100, from: '2026-10-01T10:00:00Z', to: '2026-10-01T11:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.visible.mockResolvedValue(true)
  m.orchestrator.mockResolvedValue({ matches: [{ alerts: [{ id: 'a1' }, { id: 'a2' }], incident: { id: 'i1' } }] })
})

describe('POST /incidents/for-outages', () => {
  it('relays the outages and answers the matches', async () => {
    const res = await callRoute(POST as any, { body: { outages: [outage] } })
    expect(res.status).toBe(200)
    expect(m.orchestrator).toHaveBeenCalledWith('/incidents/for-outages', { method: 'POST', body: { outages: [outage] } })
    expect((await res.json()).matches[0].incident).toEqual({ id: 'i1' })
  })

  it('400 invalid_body for 201 outages, nothing relayed', async () => {
    const res = await callRoute(POST as any, { body: { outages: Array(201).fill(outage) } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('drops the alerts outside the caller perimeter', async () => {
    m.visible.mockImplementation(async (a: { id: string }) => a.id === 'a1')
    const body = await (await callRoute(POST as any, { body: { outages: [outage] } })).json()
    expect(body.matches[0].alerts).toEqual([{ id: 'a1' }])
  })

  it('404 for a session of another tenant', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', email: 'a@x', tenantId: 'acme' } })
    expect((await callRoute(POST as any, { body: { outages: [outage] } })).status).toBe(404)
  })
})
