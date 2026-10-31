import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  visible: vi.fn(),
  infra: vi.fn(),
  rbacScope: vi.fn(),
  getAlert: vi.fn(),
  vmids: vi.fn(),
}))

vi.mock('@/lib/alerts/visibility', () => ({ isAlertVisibleToTenant: (...a: unknown[]) => m.visible(...a) }))
vi.mock('@/lib/alerts/vdcVmids', () => ({ getVdcVmidsByConnection: (...a: unknown[]) => m.vmids(...a) }))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1']),
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: unknown[]) => m.infra(...a),
  maskingScope: () => null,
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage' },
  getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a),
}))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  alertsApi: { getAlert: (...a: unknown[]) => m.getAlert(...a) },
}))

import { outagesOfAlerts, refuseInvisibleAlert, visibleAlertFilter, visibleView, visibleViews } from './alertVisibility'

const RBAC = { fake: 'scope' }

beforeEach(() => {
  vi.clearAllMocks()
  m.infra.mockResolvedValue({ kind: 'provider' })
  m.rbacScope.mockResolvedValue(RBAC)
  m.visible.mockImplementation(async (a: { id: string }) => !a.id.startsWith('hidden'))
  m.getAlert.mockResolvedValue({ data: { id: 'a1' } })
})

describe('visibleAlertFilter', () => {
  it('asks the RBAC scope of the permission given, ignoring the vDC view context', async () => {
    const isVisible = await visibleAlertFilter('alerts.manage' as any)
    expect(m.infra).toHaveBeenCalledWith('default', { ignoreVdcContext: true })
    expect(m.rbacScope).toHaveBeenCalledWith('alerts.manage')
    await isVisible({ id: 'a1' } as any)
    expect(m.visible).toHaveBeenCalledWith({ id: 'a1' }, expect.objectContaining({ tenantId: 'default', infraKind: 'provider', rbacScope: RBAC }))
  })
})

describe('refuseInvisibleAlert', () => {
  it('null for a visible alert', async () => {
    expect(await refuseInvisibleAlert('a1', 'alerts.manage' as any)).toBeNull()
  })

  it('404 not_found for an alert outside the perimeter', async () => {
    m.getAlert.mockResolvedValue({ data: { id: 'hidden1' } })
    const res = await refuseInvisibleAlert('hidden1', 'alerts.manage' as any)
    expect(res?.status).toBe(404)
    expect(await res?.json()).toEqual({ error: 'not_found' })
  })

  it('lets an alert unknown upstream (404) through, the register answers it', async () => {
    m.getAlert.mockRejectedValue(new Error('Orchestrator 404: {"error":"alert not found"}'))
    expect(await refuseInvisibleAlert('ghost', 'alerts.manage' as any)).toBeNull()
  })

  it('rethrows any other error', async () => {
    m.getAlert.mockRejectedValue(new Error('Orchestrator 500: boom'))
    await expect(refuseInvisibleAlert('a1', 'alerts.manage' as any)).rejects.toThrow('boom')
  })
})

describe('visibleView', () => {
  const view = { id: 'i1', alert_count: 3, alerts: [{ id: 'a1' }, { id: 'hidden2' }, { id: 'a3' }] }

  it('filters the alerts and recomputes the count', async () => {
    const out = await visibleView(view, 'alerts.view' as any)
    expect(out.alerts).toEqual([{ id: 'a1' }, { id: 'a3' }])
    expect(out.alert_count).toBe(2)
    expect(m.rbacScope).toHaveBeenCalledWith('alerts.view')
  })

  it('a list resolves the perimeter once and narrows each element', async () => {
    const out = await visibleViews([view, { id: 'i2', alert_count: 1, alerts: [{ id: 'hidden9' }] }], 'alerts.view' as any)
    expect(out.map(v => v.alert_count)).toEqual([2, 0])
    expect(m.infra).toHaveBeenCalledTimes(1)
  })
})

describe('outagesOfAlerts', () => {
  const outages = [
    { connection_id: 'c1', kind: 'node', node: 'pve1', vmid: 0 },
    { connection_id: 'c1', kind: 'node', node: 'pve2', vmid: 0 },
    { connection_id: 'c1', kind: 'guest', node: '', vmid: 100 },
    { connection_id: 'c2', kind: 'guest', node: '', vmid: 100 },
    { connection_id: 'c1', kind: 'cluster', node: '', vmid: 0 },
  ]

  it('keeps the outages of the objects the alerts describe, on the same connection', () => {
    const alerts = [
      { type: 'node_down', connection_id: 'c1', resource: 'pve1' },
      { type: 'vm_down', connection_id: 'c1', resource_id: 100 },
    ]
    expect(outagesOfAlerts(outages, alerts)).toEqual([outages[0], outages[2]])
    expect(outagesOfAlerts(outages, [{ type: 'cluster_quorum', connection_id: 'c1' }])).toEqual([outages[4]])
    expect(outagesOfAlerts(outages, [])).toEqual([])
  })
})
