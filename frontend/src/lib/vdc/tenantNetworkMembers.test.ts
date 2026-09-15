/**
 * MOCK-based tests for the membership of a vDC in a stretched tenant network
 * (#901): every refusal happens before Proxmox is touched, the local VNet
 * carries the network's VNI and PVE id, the peers of every member zone are
 * re-exchanged, and a member with attached guests cannot leave.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/tenantNetworkMembers.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, sdnMock, getConnectionByIdMock, memberPeersMock, checkVnetQuotaMock, clearScopeMock } = vi.hoisted(() => ({
  prismaMock: {
    tenantNetwork: { findUnique: vi.fn() },
    tenantNetworkMember: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    vdc: { findUnique: vi.fn() },
    vdcVnet: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    vdcSubnet: { create: vi.fn() },
    connection: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  } as any,
  sdnMock: {
    applySdn: vi.fn(), countVnetAttachments: vi.fn(), createVnetPve: vi.fn(), deleteVnetPve: vi.fn(),
    listVnetsPve: vi.fn(), readZonePve: vi.fn(), setVnetFirewallEnabled: vi.fn(), updateZone: vi.fn(), listClusterNodeIps: vi.fn(),
  },
  getConnectionByIdMock: vi.fn(),
  memberPeersMock: vi.fn(),
  checkVnetQuotaMock: vi.fn(),
  clearScopeMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('./sdn', () => sdnMock)
vi.mock('./scope', () => ({ clearVdcScopeCache: clearScopeMock }))
vi.mock('./vnets', () => ({ checkVnetQuota: checkVnetQuotaMock }))
vi.mock('./transportOps', () => ({ effectiveZoneConfig: (live: any) => ({ peers: live.peers, mtu: live.mtu }) }))
vi.mock('./stretchPeers', async (importOriginal) => ({ ...(await importOriginal<any>()), memberPeersForVdc: memberPeersMock }))

import { addMember, removeMember, syncNetworkZones } from './tenantNetworkMembers'

const conn = { id: 'conn' }

const network = () => ({
  id: 'n1', tenantId: 't1', name: 'backbone', description: null, pveName: 'vaaaaaaa', vni: 10002, mtu: null, createdBy: 'u1',
  subnet: { id: 's-canon', cidr: '10.50.0.0/24', gateway: '10.50.0.1', dnsServers: '10.50.0.2', ipamEnabled: true },
  members: [] as Array<{ vdcId: string; vdc: { connectionId: string } }>,
})

// A vDC in `peers` mode, so the peer computation needs no cluster read.
const vdc = (over: Record<string, unknown> = {}) => ({
  id: 'v-prod', name: 'Acme prod', tenantId: 't1', connectionId: 'c-prod', sdnZoneName: 'zacme', enabled: true,
  vxlanTransportMode: 'peers', vxlanPeers: ['10.42.0.101', '10.42.0.102'], vxlanMtu: null,
  transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: null,
  ...over,
})

beforeEach(() => {
  for (const model of Object.values(prismaMock) as any[]) {
    if (typeof model === 'function') model.mockReset()
    else for (const fn of Object.values(model) as any[]) fn.mockReset()
  }
  for (const fn of Object.values(sdnMock)) fn.mockReset()
  getConnectionByIdMock.mockReset(); memberPeersMock.mockReset(); checkVnetQuotaMock.mockReset(); clearScopeMock.mockReset()

  prismaMock.tenantNetwork.findUnique.mockResolvedValue(network())
  prismaMock.tenantNetworkMember.findMany.mockResolvedValue([])
  prismaMock.tenantNetworkMember.create.mockResolvedValue({})
  prismaMock.vdc.findUnique.mockResolvedValue(vdc())
  prismaMock.vdcVnet.findFirst.mockResolvedValue(null)
  prismaMock.vdcVnet.create.mockResolvedValue({})
  prismaMock.vdcVnet.delete.mockResolvedValue({})
  prismaMock.vdcSubnet.create.mockResolvedValue({})
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  getConnectionByIdMock.mockResolvedValue(conn)
  sdnMock.listVnetsPve.mockResolvedValue([])
  sdnMock.readZonePve.mockResolvedValue(null)
  checkVnetQuotaMock.mockResolvedValue({ allowed: true, current: 0, max: null })
  memberPeersMock.mockResolvedValue([])
})

describe('addMember refusals, all before Proxmox is touched', () => {
  const cases: Array<[string, () => void, string]> = [
    ['unknown network', () => prismaMock.tenantNetwork.findUnique.mockResolvedValue(null), 'Tenant network: not found: n1'],
    ['network without subnet', () => prismaMock.tenantNetwork.findUnique.mockResolvedValue({ ...network(), subnet: null }), 'has no subnet yet'],
    ['unknown vDC', () => prismaMock.vdc.findUnique.mockResolvedValue(null), 'vDC not found: v-prod'],
    ['vDC of another tenant', () => prismaMock.vdc.findUnique.mockResolvedValue(vdc({ tenantId: 't2' })), 'belongs to another tenant'],
    ['disabled vDC', () => prismaMock.vdc.findUnique.mockResolvedValue(vdc({ enabled: false })), 'is disabled'],
    ['VLAN-only vDC', () => prismaMock.vdc.findUnique.mockResolvedValue(vdc({ sdnZoneName: null })), 'has no VXLAN zone'],
    ['already a member', () => prismaMock.tenantNetwork.findUnique.mockResolvedValue({ ...network(), members: [{ vdcId: 'v-prod', vdc: { connectionId: 'c-prod' } }] }), 'already carries "backbone"'],
    ['another member on the same cluster', () => prismaMock.tenantNetwork.findUnique.mockResolvedValue({ ...network(), members: [{ vdcId: 'v-other', vdc: { connectionId: 'c-prod' } }] }), 'a VNI exists once per cluster'],
    ['zone MTU differs from the network MTU', () => prismaMock.vdc.findUnique.mockResolvedValue(vdc({ vxlanMtu: 1400 })), 'zone MTU of vDC "Acme prod" (1400) differs from the network MTU (the Proxmox default)'],
    ['VNet quota reached', () => checkVnetQuotaMock.mockResolvedValue({ allowed: false, current: 2, max: 2 }), 'quota exceeded on vDC "Acme prod": max_vnets=2, current=2'],
    ['a VNet of that name already in the vDC', () => prismaMock.vdcVnet.findFirst.mockResolvedValue({ id: 'clash' }), 'already has a network named "backbone"'],
  ]
  for (const [label, arrange, message] of cases) {
    it(label, async () => {
      arrange()
      await expect(addMember('n1', 'v-prod')).rejects.toThrow(message)
      expect(sdnMock.createVnetPve).not.toHaveBeenCalled()
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })
  }
})

describe('addMember', () => {
  it("creates the local VNet with the network's VNI, id and alias, its mirror subnet and the membership, then applies and enables the firewall", async () => {
    const out = await addMember('n1', 'v-prod')

    expect(sdnMock.createVnetPve).toHaveBeenCalledWith(conn, { pveName: 'vaaaaaaa', zoneName: 'zacme', tag: 10002, alias: 'backbone' })
    expect(prismaMock.vdcVnet.create.mock.calls[0][0].data).toMatchObject({
      vdcId: 'v-prod', pveName: 'vaaaaaaa', displayName: 'backbone', tag: 10002, type: 'vxlan', zoneName: 'zacme', firewall: true, createdBy: 'u1',
    })
    const vnetId = prismaMock.vdcVnet.create.mock.calls[0][0].data.id
    expect(prismaMock.vdcSubnet.create.mock.calls[0][0].data).toMatchObject({ vnetId, cidr: '10.50.0.0/24', gateway: '10.50.0.1', dnsServers: '10.50.0.2', ipamEnabled: true })
    expect(prismaMock.tenantNetworkMember.create.mock.calls[0][0].data).toMatchObject({ tenantNetworkId: 'n1', vdcId: 'v-prod', vnetId })
    expect(sdnMock.applySdn).toHaveBeenCalledWith(conn)
    expect(sdnMock.setVnetFirewallEnabled).toHaveBeenCalledWith(conn, 'vaaaaaaa', true)
    expect(clearScopeMock).toHaveBeenCalledWith('t1')
    expect(out).toMatchObject({ vdcId: 'v-prod', vnetId, pveName: 'vaaaaaaa', zoneSync: [] })
  })

  it("falls back to a per-cluster variant when the cluster already holds the network's PVE id", async () => {
    sdnMock.listVnetsPve.mockResolvedValue([{ vnet: 'vaaaaaaa', zone: 'zlegacy', tag: 77, firewall: 0 }])
    const out = await addMember('n1', 'v-prod')
    expect(out.pveName).toMatch(/^v[0-9a-f]{7}$/)
    expect(out.pveName).not.toBe('vaaaaaaa')
    expect(sdnMock.createVnetPve.mock.calls[0][1].pveName).toBe(out.pveName)
  })

  it('deletes the Proxmox VNet again when the rows cannot be written', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('unique violation'))
    await expect(addMember('n1', 'v-prod')).rejects.toThrow('failed to persist the membership of vDC "Acme prod": unique violation')
    expect(sdnMock.deleteVnetPve).toHaveBeenCalledWith(conn, 'vaaaaaaa')
    expect(sdnMock.applySdn).not.toHaveBeenCalled()
  })
})

describe('removeMember', () => {
  const member = () => ({
    vnet: { id: 'vn-1', pveName: 'vaaaaaaa' },
    vdc: { name: 'Acme prod', tenantId: 't1', connectionId: 'c-prod' },
    tenantNetwork: { name: 'backbone' },
  })

  it('refuses while guest NICs still use the local VNet', async () => {
    prismaMock.tenantNetworkMember.findUnique.mockResolvedValue(member())
    sdnMock.countVnetAttachments.mockResolvedValue(2)
    await expect(removeMember('n1', 'v-prod')).rejects.toThrow('2 guest NIC(s) still use "backbone" on vDC "Acme prod"')
    expect(sdnMock.deleteVnetPve).not.toHaveBeenCalled()
    expect(prismaMock.vdcVnet.delete).not.toHaveBeenCalled()
  })

  it('deletes the local VNet on Proxmox and in the database, applies, and re-exchanges the peers', async () => {
    prismaMock.tenantNetworkMember.findUnique.mockResolvedValue(member())
    sdnMock.countVnetAttachments.mockResolvedValue(0)
    const out = await removeMember('n1', 'v-prod')
    expect(sdnMock.deleteVnetPve).toHaveBeenCalledWith(conn, 'vaaaaaaa')
    expect(prismaMock.vdcVnet.delete).toHaveBeenCalledWith({ where: { id: 'vn-1' } })
    expect(sdnMock.applySdn).toHaveBeenCalledWith(conn)
    expect(clearScopeMock).toHaveBeenCalledWith('t1')
    expect(out.zoneSync).toEqual([])
  })

  it('refuses a vDC that does not carry the network', async () => {
    prismaMock.tenantNetworkMember.findUnique.mockResolvedValue(null)
    await expect(removeMember('n1', 'v-x')).rejects.toThrow('does not carry the network')
  })
})

describe('syncNetworkZones', () => {
  const dr = vdc({ id: 'v-dr', name: 'Acme DR', connectionId: 'c-dr', sdnZoneName: 'zacmedr', vxlanPeers: ['10.42.0.111'] })

  it("rewrites only the zones whose live peers differ from their own plus the other members', and applies per cluster", async () => {
    prismaMock.tenantNetworkMember.findMany.mockResolvedValue([{ vdc: vdc() }, { vdc: dr }])
    memberPeersMock.mockImplementation(async (id: string) => (id === 'v-prod' ? ['10.42.0.111'] : ['10.42.0.101', '10.42.0.102']))
    sdnMock.readZonePve.mockImplementation(async (_c: any, zone: string) =>
      zone === 'zacme'
        ? { type: 'vxlan', peers: ['10.42.0.101', '10.42.0.102', '10.42.0.111'], mtu: null, state: null, pending: null }
        : { type: 'vxlan', peers: ['10.42.0.111'], mtu: null, state: null, pending: null })

    const out = await syncNetworkZones('n1')

    expect(out).toEqual([
      { vdcId: 'v-prod', vdcName: 'Acme prod', connectionId: 'c-prod', zoneName: 'zacme', changed: false },
      { vdcId: 'v-dr', vdcName: 'Acme DR', connectionId: 'c-dr', zoneName: 'zacmedr', changed: true },
    ])
    expect(sdnMock.updateZone).toHaveBeenCalledTimes(1)
    expect(sdnMock.updateZone).toHaveBeenCalledWith(conn, 'zacmedr', { peers: ['10.42.0.111', '10.42.0.101', '10.42.0.102'], mtu: null })
    expect(sdnMock.applySdn).toHaveBeenCalledTimes(1)
  })

  it('reports a cluster that fails and keeps going with the others', async () => {
    prismaMock.tenantNetworkMember.findMany.mockResolvedValue([{ vdc: vdc() }, { vdc: dr }])
    sdnMock.readZonePve.mockImplementation(async (_c: any, zone: string) =>
      zone === 'zacme' ? null : { type: 'vxlan', peers: ['10.42.0.111'], mtu: null, state: null, pending: null })

    const out = await syncNetworkZones('n1')
    expect(out[0]).toMatchObject({ vdcId: 'v-prod', changed: false, error: 'zone "zacme" not found on Proxmox' })
    expect(out[1]).toMatchObject({ vdcId: 'v-dr', changed: false })
    expect(out[1].error).toBeUndefined()
  })
})
