import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), connFindUnique: vi.fn(), getConnectionById: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdc: { findMany: h.findMany, findFirst: h.findFirst, findUnique: h.findUnique },
    connection: { findUnique: h.connFindUnique },
  },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: h.getConnectionById }))

import { diskStoragesOf, findVdcByPool, loadPveConnection, loadTenantVdcs, loadVdcById, policyCapsFor, quotaPoliciesOf } from './context'

const ROW = {
  id: 'vdc-1', tenantId: 'acme', name: 'Lyon', connectionId: 'conn-b', pvePoolName: 'vdc-acme-lyon', primaryStorage: 'rbd',
  cpuModelMode: 'selected', cpuAllowedModels: ['x86-64-v3'], cpuDefaultModel: null, cpuAdvancedSettings: false,
  quota: { maxVcpus: 16, maxRamMb: null, maxStorageMb: 1024, maxVms: 4, maxSnapshots: null, maxBackups: null },
  nodes: [{ nodeName: 'pve1-dr' }],
  storagePolicies: [{ quotaMb: 2048, policy: { id: 'p1', name: 'Gold', storageId: 'nvme', iopsRd: 1000, iopsWr: null, mbpsRd: null, mbpsWr: 100 } }],
  vnets: [
    { id: 'vn1', pveName: 'tnet01', displayName: 'lan', tenantNetworkMember: { tenantNetworkId: 'net-1' } },
    { id: 'vn2', pveName: 'v1234567', displayName: null, tenantNetworkMember: null },
  ],
  sharedBridges: [{ bridge: 'vmbr1', label: null }],
  vlanPools: [{ bridge: 'vmbr1', rangeStart: 100, rangeEnd: 199 }, { bridge: 'vmbr1', rangeStart: 300, rangeEnd: 310 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([ROW])
  h.findFirst.mockResolvedValue(ROW)
  h.findUnique.mockResolvedValue({ ...ROW, quota: null, primaryStorage: null, storagePolicies: [], vlanPools: [] })
})

describe('vDC loading for a move', () => {
  it('projects everything a move needs from a vDC row', async () => {
    const [vdc] = await loadTenantVdcs('acme')
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'acme', enabled: true } }))
    expect(vdc).toMatchObject({
      id: 'vdc-1', poolName: 'vdc-acme-lyon', primaryStorage: 'rbd', nodes: new Set(['pve1-dr']),
      quota: { maxVcpus: 16, maxRamMb: null, maxStorageMb: 1024, maxVms: 4, maxSnapshots: null, maxBackups: null },
      computePolicy: { cpuModelMode: 'selected', cpuAllowedModels: ['x86-64-v3'], cpuAdvancedSettings: false },
    })
    expect(vdc.policies).toEqual([{ policyId: 'p1', name: 'Gold', storageId: 'nvme', quotaMb: 2048, caps: { iopsRd: 1000, iopsWr: null, mbpsRd: null, mbpsWr: 100 } }])
    expect(vdc.networks).toEqual([
      { bridge: 'tnet01', label: 'lan', kind: 'vnet', vnetId: 'vn1', tenantNetworkId: 'net-1' },
      { bridge: 'v1234567', label: 'v1234567', kind: 'vnet', vnetId: 'vn2', tenantNetworkId: null },
      { bridge: 'vmbr1', label: 'vmbr1', kind: 'shared', vnetId: null, tenantNetworkId: null },
    ])
    expect(vdc.vlanRanges.get('vmbr1')).toEqual([[100, 199], [300, 310]])
    expect([...diskStoragesOf(vdc)].sort()).toEqual(['nvme', 'rbd'])
    expect(policyCapsFor(vdc, 'nvme')).toEqual({ iopsRd: 1000, iopsWr: null, mbpsRd: null, mbpsWr: 100 })
    expect(policyCapsFor(vdc, 'rbd')).toBeUndefined()
    expect(quotaPoliciesOf(vdc)).toEqual([{ policyId: 'p1', name: 'Gold', storageId: 'nvme', quotaMb: 2048 }])
  })

  it('finds a vDC by its pool and by id, null when absent', async () => {
    expect((await findVdcByPool('conn-b', 'vdc-acme-lyon'))?.id).toBe('vdc-1')
    expect(h.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: 'conn-b', pvePoolName: 'vdc-acme-lyon', enabled: true } }))
    const byId = await loadVdcById('vdc-1')
    expect(byId?.quota).toBeNull()
    expect([...diskStoragesOf(byId!)]).toEqual([])
    h.findFirst.mockResolvedValue(null)
    h.findUnique.mockResolvedValue(null)
    expect(await findVdcByPool('conn-b', 'x')).toBeNull()
    expect(await loadVdcById('x')).toBeNull()
  })

  it('loads a connection as its owner tenant', async () => {
    h.connFindUnique.mockResolvedValue({ tenantId: 'default' })
    h.getConnectionById.mockResolvedValue({ id: 'conn-b' })
    expect(await loadPveConnection('conn-b')).toEqual({ id: 'conn-b' })
    expect(h.getConnectionById).toHaveBeenCalledWith('conn-b', 'default')
    h.connFindUnique.mockResolvedValue(null)
    await expect(loadPveConnection('nope')).rejects.toThrow('Connection not found')
  })
})
