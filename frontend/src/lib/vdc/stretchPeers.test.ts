/**
 * MOCK-based tests for the peers a stretched tenant network adds to a vDC's
 * zone (#901). Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/stretchPeers.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, getConnectionByIdMock, listClusterNodeIpsMock } = vi.hoisted(() => ({
  prismaMock: {
    tenantNetworkMember: { findMany: vi.fn() },
    connection: { findUnique: vi.fn() },
  } as any,
  getConnectionByIdMock: vi.fn(),
  listClusterNodeIpsMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('./sdn', () => ({ listClusterNodeIps: listClusterNodeIpsMock }))

import { memberPeersForVdc, withMemberPeers, zoneConfigOfVdc } from './stretchPeers'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'v1', name: 'Acme prod', connectionId: 'c1', sdnZoneName: 'z1',
  vxlanTransportMode: 'cluster', vxlanPeers: [], vxlanMtu: null,
  transportVlanId: null, transportDevice: null, transportCidr: null, transportNodeAddresses: null,
  ...over,
})

beforeEach(() => {
  prismaMock.tenantNetworkMember.findMany.mockReset()
  prismaMock.connection.findUnique.mockReset().mockResolvedValue({ tenantId: 'default' })
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn' })
  listClusterNodeIpsMock.mockReset().mockResolvedValue(['10.42.0.101', '10.42.0.102'])
})

describe('zoneConfigOfVdc', () => {
  it("reads the node addresses of the vDC's own cluster in cluster mode", async () => {
    await expect(zoneConfigOfVdc(row())).resolves.toEqual({ peers: ['10.42.0.101', '10.42.0.102'], mtu: null })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'default')
  })

  it('needs no cluster read in peers or transport mode, and carries the zone MTU', async () => {
    const peers = row({ vxlanTransportMode: 'peers', vxlanPeers: ['192.0.2.1'], vxlanMtu: 1400 })
    await expect(zoneConfigOfVdc(peers)).resolves.toEqual({ peers: ['192.0.2.1'], mtu: 1400 })
    const transport = row({
      vxlanTransportMode: 'transport', vxlanPeers: ['10.100.5.254'], transportVlanId: 4000, transportDevice: 'vmbr0',
      transportCidr: '10.100.5.0/24', transportNodeAddresses: { pve1: '10.100.5.1' },
    })
    await expect(zoneConfigOfVdc(transport)).resolves.toEqual({ peers: ['10.100.5.1', '10.100.5.254'], mtu: null })
    expect(listClusterNodeIpsMock).not.toHaveBeenCalled()
  })

  it('names the vDC when its cluster cannot be read', async () => {
    listClusterNodeIpsMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(zoneConfigOfVdc(row())).rejects.toThrow('cannot read the node addresses of the cluster of vDC "Acme prod": ECONNREFUSED')
  })
})

describe('memberPeersForVdc', () => {
  it('is empty and reads nothing more for a vDC that carries no network', async () => {
    prismaMock.tenantNetworkMember.findMany.mockResolvedValueOnce([])
    await expect(memberPeersForVdc('v1')).resolves.toEqual([])
    expect(prismaMock.tenantNetworkMember.findMany).toHaveBeenCalledTimes(1)
  })

  it('unions the peers of the other members over every network it carries, never its own', async () => {
    prismaMock.tenantNetworkMember.findMany
      .mockResolvedValueOnce([{ tenantNetworkId: 'n1' }, { tenantNetworkId: 'n2' }])
      .mockResolvedValueOnce([
        { vdc: row({ id: 'v2', name: 'Acme DR', connectionId: 'c2', vxlanTransportMode: 'peers', vxlanPeers: ['10.42.0.111', '10.42.0.112'] }) },
        { vdc: row({ id: 'v3', name: 'Acme test', connectionId: 'c3', vxlanTransportMode: 'peers', vxlanPeers: ['10.42.0.112', '10.42.0.121'] }) },
      ])
    await expect(memberPeersForVdc('v1')).resolves.toEqual(['10.42.0.111', '10.42.0.112', '10.42.0.121'])
    expect(prismaMock.tenantNetworkMember.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { tenantNetworkId: { in: ['n1', 'n2'] }, vdcId: { not: 'v1' } },
    }))
  })

  it("reads the other member's cluster when it runs in cluster mode", async () => {
    prismaMock.tenantNetworkMember.findMany
      .mockResolvedValueOnce([{ tenantNetworkId: 'n1' }])
      .mockResolvedValueOnce([{ vdc: row({ id: 'v2', name: 'Acme DR', connectionId: 'c2' }) }])
    listClusterNodeIpsMock.mockResolvedValue(['10.42.0.111', '10.42.0.112', '10.42.0.113'])
    await expect(memberPeersForVdc('v1')).resolves.toEqual(['10.42.0.111', '10.42.0.112', '10.42.0.113'])
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c2', 'default')
  })
})

describe('withMemberPeers', () => {
  it('returns the zone untouched without member peers, otherwise appends them without duplicates and keeps the MTU', () => {
    const zone = { peers: ['10.42.0.101'], mtu: 1400 }
    expect(withMemberPeers(zone, [])).toBe(zone)
    expect(withMemberPeers(zone, ['10.42.0.111', '10.42.0.101'])).toEqual({ peers: ['10.42.0.101', '10.42.0.111'], mtu: 1400 })
  })
})
