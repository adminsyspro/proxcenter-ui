// collectInventorySnapshot({ permission }): the perimeter is where THAT
// permission was granted, not every grant of the caller (roadmap#223: the
// local alert writes are judged on alerts.manage, not on what the caller views).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  infraScope: vi.fn(),
  filterVms: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: async () => ({ kind: 'provider' }),
  maskingScope: () => null,
}))
vi.mock('@/lib/vdc/context', () => ({ getVdcContext: async () => null }))
vi.mock('@/lib/vdc/scope', () => ({ applyVdcFilter: (c: unknown) => c }))
vi.mock('@/lib/inventory/fetchRawInventory', () => ({
  getInventorySWR: async () => ({
    cached: true,
    raw: { clusters: [{ id: 'c1', name: 'PVE', nodes: [{ node: 'pve1', guests: [{ vmid: 101, type: 'qemu', name: 'web' }] }] }] },
  }),
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_VIEW: 'vm.view' },
  getRBACContext: async () => ({ userId: 'u1', isAdmin: false, tenantId: 'default' }),
  getRbacInfraScope: (...a: unknown[]) => m.infraScope(...a),
  filterVmsByPermission: (...a: unknown[]) => m.filterVms(...a),
  filterCandidateConnections: (c: unknown) => c,
  applyRbacInfraFilter: (c: unknown) => c,
  pruneEmptyConnections: (c: unknown) => c,
}))

import { collectInventorySnapshot } from './snapshot'

beforeEach(() => {
  vi.clearAllMocks()
  m.infraScope.mockResolvedValue({ connectionIds: new Set(['c1']) })
  m.filterVms.mockImplementation(async (_p: unknown, vms: unknown[]) => vms)
})

describe('collectInventorySnapshot permission', () => {
  it('keeps the union of every grant and vm.view by default', async () => {
    await collectInventorySnapshot()
    expect(m.infraScope).toHaveBeenCalledWith('u1', 'default')
    expect(m.filterVms.mock.calls[0][2]).toBe('vm.view')
  })

  it('narrows the hosts and the guests to the grants of the permission given', async () => {
    const snap = await collectInventorySnapshot({ permission: 'alerts.manage' })
    expect(m.infraScope).toHaveBeenCalledWith('u1', 'default', 'alerts.manage')
    expect(m.filterVms.mock.calls[0][2]).toBe('alerts.manage')
    expect(snap.guests.map(g => g.vmid)).toEqual(['101'])
  })
})
