/**
 * Postgres-backed tests for the audit of VNIs shared between clusters and
 * the renumbering of a ProxCenter network (#1334). Proxmox is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

interface FakeCluster { zones: any[]; vnets: any[]; controllers: any[]; applies: number; down?: boolean; failPut?: boolean }
const clusters: Record<string, FakeCluster> = {}
const puts: Array<{ conn: string; path: string; tag: string | null }> = []

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: `https://${id}`, apiToken: 'tok' }) }))

import { auditVniCollisions, renumberVnet } from './vniCollisions'

const TABLES = ['sdn_evpn_zone_members', 'sdn_evpn_zones', 'tenant_network_members', 'tenant_networks', 'vdc_vnets', 'vdcs', 'provider_connections', 'Connection', 'tenants']

const evpnController = [{ controller: 'evpn1', type: 'evpn' }]

beforeEach(async () => {
  await truncate(TABLES)
  puts.length = 0
  clusters['conn-1'] = { zones: [{ zone: 'za', type: 'vxlan' }, { zone: 'zvlan', type: 'vlan' }], vnets: [], controllers: [], applies: 0 }
  clusters['conn-2'] = { zones: [{ zone: 'zb', type: 'vxlan' }], vnets: [], controllers: [], applies: 0 }
  pveFetchMock.mockReset()
  pveFetchMock.mockImplementation(async (conn: any, path: string, init: any = {}) => {
    const c = clusters[conn.id]
    if (!c || c.down) throw new Error('connect ECONNREFUSED')
    if (path === '/cluster/sdn/zones') return c.zones
    if (path === '/cluster/sdn/vnets') return c.vnets
    if (path === '/cluster/sdn/controllers') return c.controllers
    if (path === '/cluster/sdn' && init.method === 'PUT') { c.applies++; return null }
    if (path.startsWith('/cluster/sdn/vnets/') && init.method === 'PUT') {
      if (c.failPut) throw new Error('400 tag refused')
      puts.push({ conn: conn.id, path, tag: init.body.get('tag') })
      return null
    }
    throw new Error(`unexpected PVE call ${path}`)
  })
  const now = new Date()
  await prismaTest.tenant.create({ data: { id: 'tenant-a', slug: 'tenant-a', name: 'Acme', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn-1', tenantId: 'default', name: 'paris', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-2', tenantId: 'default', name: 'lyon', baseUrl: 'https://pve2', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({ data: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }] })
  })
  await prismaTest.vdc.createMany({
    data: [
      { id: 'vdc-a', tenantId: 'tenant-a', connectionId: 'conn-1', name: 'Acme prod', slug: 'a', pvePoolName: 'pa', sdnZoneName: 'za' },
      { id: 'vdc-b', tenantId: 'tenant-a', connectionId: 'conn-2', name: 'Acme DR', slug: 'b', pvePoolName: 'pb', sdnZoneName: 'zb' },
    ],
  })
})

async function managed(id: string, vdcId: string, pveName: string, tag: number, displayName: string) {
  await prismaTest.vdcVnet.create({ data: { id, vdcId, pveName, displayName, tag, type: 'vxlan' } })
}

describe('auditVniCollisions', () => {
  it('finds a VNI two clusters carry for unrelated networks and tells which side can move', async () => {
    await managed('vn-1', 'vdc-a', 'vlan1', 10001, 'dmz')
    clusters['conn-1'].vnets.push({ vnet: 'vlan1', zone: 'za', tag: 10001 }, { vnet: 'vwan', zone: 'zvlan', tag: 10001 }, { vnet: 'solo', zone: 'za', tag: 10009 })
    clusters['conn-2'].vnets.push({ vnet: 'vhand', zone: 'zb', tag: 10001, alias: 'manual' })
    const { collisions, unreachable } = await auditVniCollisions()
    expect(unreachable).toEqual([])
    expect(collisions).toEqual([{
      vni: 10001,
      exposed: false,
      holders: [
        { connectionId: 'conn-2', connectionName: 'lyon', zone: 'zb', zoneType: 'vxlan', vnet: 'vhand', alias: 'manual', vdcVnetId: null, vdcName: null, tenantName: null, renumberable: false },
        { connectionId: 'conn-1', connectionName: 'paris', zone: 'za', zoneType: 'vxlan', vnet: 'vlan1', alias: 'dmz', vdcVnetId: 'vn-1', vdcName: 'Acme prod', tenantName: 'Acme', renumberable: true },
      ],
    }])
  })

  it('flags the collision as exposed once both clusters run an EVPN controller', async () => {
    clusters['conn-1'].controllers = evpnController
    clusters['conn-2'].controllers = evpnController
    clusters['conn-1'].vnets.push({ vnet: 'v1', zone: 'za', tag: 500 })
    clusters['conn-2'].vnets.push({ vnet: 'v2', zone: 'zb', tag: 500 })
    expect((await auditVniCollisions()).collisions[0]).toMatchObject({ vni: 500, exposed: true })
  })

  it('does not report networks that share a VNI on purpose', async () => {
    // One stretched tenant network on both clusters.
    await managed('vn-1', 'vdc-a', 'vstr', 10002, 'backbone')
    await managed('vn-2', 'vdc-b', 'vstr', 10002, 'backbone')
    await prismaTest.tenantNetwork.create({ data: { id: 'tn-1', tenantId: 'tenant-a', name: 'backbone', pveName: 'vstr', vni: 10002 } })
    await prismaTest.tenantNetworkMember.createMany({
      data: [
        { id: 'm1', tenantNetworkId: 'tn-1', vdcId: 'vdc-a', vnetId: 'vn-1' },
        { id: 'm2', tenantNetworkId: 'tn-1', vdcId: 'vdc-b', vnetId: 'vn-2' },
      ],
    })
    // One EVPN zone on both clusters: its VNets and its VRF.
    for (const id of ['conn-1', 'conn-2']) {
      clusters[id].zones.push({ zone: 'zevpn', type: 'evpn', 'vrf-vxlan': 9000 })
      clusters[id].vnets.push({ vnet: 'vstr', zone: id === 'conn-1' ? 'za' : 'zb', tag: 10002 }, { vnet: 'vev', zone: 'zevpn', tag: 9001 })
    }
    expect((await auditVniCollisions()).collisions).toEqual([])
  })

  it('reports a VNet sitting on the VRF VNI of an EVPN zone, even on one cluster', async () => {
    clusters['conn-1'].zones.push({ zone: 'zevpn', type: 'evpn', 'vrf-vxlan': 9000 })
    clusters['conn-1'].vnets.push({ vnet: 'vbad', zone: 'za', tag: 9000 })
    const { collisions } = await auditVniCollisions()
    expect(collisions).toHaveLength(1)
    expect(collisions[0].holders.map(h => h.vnet)).toEqual(['vbad', null])
  })

  it('names the clusters it could not read', async () => {
    clusters['conn-2'].down = true
    expect(await auditVniCollisions()).toEqual({ collisions: [], unreachable: ['lyon'] })
  })
})

describe('renumberVnet', () => {
  it('moves the network to the next free VNI, in Proxmox then in the database, and applies', async () => {
    await managed('vn-1', 'vdc-a', 'vlan1', 10001, 'dmz')
    clusters['conn-1'].vnets.push({ vnet: 'vlan1', zone: 'za', tag: 10001 })
    clusters['conn-2'].vnets.push({ vnet: 'vhand', zone: 'zb', tag: 10002 })
    expect(await renumberVnet('vn-1')).toEqual({ vdcVnetId: 'vn-1', previousVni: 10001, vni: 10003 })
    expect(puts).toEqual([{ conn: 'conn-1', path: '/cluster/sdn/vnets/vlan1', tag: '10003' }])
    expect(clusters['conn-1'].applies).toBe(1)
    expect((await prismaTest.vdcVnet.findUnique({ where: { id: 'vn-1' } }))?.tag).toBe(10003)
  })

  it('stays inside the VNI range of the vDC', async () => {
    await prismaTest.vdc.update({ where: { id: 'vdc-a' }, data: { vniRangeStart: 20000, vniRangeEnd: 20010 } })
    await managed('vn-1', 'vdc-a', 'vlan1', 20000, 'dmz')
    clusters['conn-1'].vnets.push({ vnet: 'vlan1', zone: 'za', tag: 20000 })
    expect((await renumberVnet('vn-1')).vni).toBe(20001)
  })

  it('refuses what cannot move, and leaves the database alone when Proxmox refuses', async () => {
    await expect(renumberVnet('ghost')).rejects.toThrow('VNI collision: network not found')
    await prismaTest.vdcVnet.create({ data: { id: 'vn-vlan', vdcId: 'vdc-a', pveName: 'vl', displayName: 'vl', tag: 100, type: 'vlan' } })
    await expect(renumberVnet('vn-vlan')).rejects.toThrow('only a VXLAN network carries a VNI')

    await managed('vn-1', 'vdc-a', 'vstr', 10002, 'backbone')
    await prismaTest.tenantNetwork.create({ data: { id: 'tn-1', tenantId: 'tenant-a', name: 'backbone', pveName: 'vstr', vni: 10002 } })
    await prismaTest.tenantNetworkMember.create({ data: { id: 'm1', tenantNetworkId: 'tn-1', vdcId: 'vdc-a', vnetId: 'vn-1' } })
    await expect(renumberVnet('vn-1')).rejects.toThrow('a stretched tenant network keeps one VNI')

    await managed('vn-2', 'vdc-a', 'vlan2', 10005, 'lan')
    clusters['conn-1'].failPut = true
    await expect(renumberVnet('vn-2')).rejects.toThrow('Failed to update SDN VNet "lan": 400 tag refused')
    expect((await prismaTest.vdcVnet.findUnique({ where: { id: 'vn-2' } }))?.tag).toBe(10005)
    expect(clusters['conn-1'].applies).toBe(0)
  })
})
