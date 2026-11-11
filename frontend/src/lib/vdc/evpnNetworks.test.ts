/**
 * Postgres-backed tests for the networks a tenant creates in a shared EVPN
 * zone (#1334): one network present on the vDCs the tenant chooses, each
 * presence counting in that vDC's quota. Proxmox is a small in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

interface FakeCluster { vnets: any[]; applies: number; guests: Array<{ vmid: number; bridge: string }>; failVnetCreate?: boolean }
const clusters: Record<string, FakeCluster> = {}

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: `https://${id}`, apiToken: 'tok' }) }))
vi.mock('./scope', () => ({ clearVdcScopeCache: vi.fn() }))

import { deleteEvpnZone, updateEvpnZone } from './evpnZones'
import { createEvpnNetworkForTenant, evpnContextForVdc, setEvpnNetworkPresence } from './evpnNetworks'
import { assertEvpnDetachSafe, assertEvpnZoneForCluster, attachedVdcCount } from './evpnVdc'
import { listTenantNetworks } from './tenantNetworks'
import { createVnetForTenant, deleteVnetForTenant, listVnetsForTenant, updateVnetForTenant } from './vnets'

const TABLES = [
  'vdc_ipam_allocations', 'vdc_subnets', 'tenant_network_members', 'tenant_networks', 'vdc_vnets', 'vdc_quotas', 'vdcs',
  'sdn_evpn_zone_members', 'sdn_evpn_zones', 'provider_connections', 'Connection', 'tenants',
]

function fake(conn: any, path: string, init: any = {}): any {
  const c = clusters[conn.id]
  if (!c) throw new Error('connect ECONNREFUSED')
  const method = init.method ?? 'GET'
  if (path === '/cluster/sdn/zones') return [{ zone: 'zshared', type: 'evpn', 'vrf-vxlan': 9000 }]
  if (path === '/cluster/sdn/controllers') return [{ controller: 'evpn1', type: 'evpn' }]
  if (path === '/cluster/sdn/vnets' && method === 'GET') return c.vnets
  if (path === '/cluster/sdn/vnets' && method === 'POST') {
    if (c.failVnetCreate) throw new Error('400 vnet refused')
    c.vnets.push({ vnet: init.body.get('vnet'), zone: init.body.get('zone'), tag: Number(init.body.get('tag')), alias: init.body.get('alias') })
    return null
  }
  if (path.startsWith('/cluster/sdn/vnets/') && method === 'DELETE') {
    c.vnets = c.vnets.filter(v => v.vnet !== decodeURIComponent(path.split('/')[4]))
    return null
  }
  if (path.startsWith('/cluster/sdn/vnets/')) return null // firewall options
  if (path === '/cluster/sdn' && method === 'PUT') { c.applies++; return null }
  if (path.startsWith('/cluster/resources')) return c.guests.map(g => ({ vmid: g.vmid, node: 'n1', type: 'qemu' }))
  const cfg = /^\/nodes\/n1\/qemu\/(\d+)\/config$/.exec(path)
  if (cfg) return { net0: `virtio=AA:BB,bridge=${c.guests.find(g => g.vmid === Number(cfg[1]))!.bridge}` }
  throw new Error(`unexpected PVE call ${method} ${path}`)
}

beforeEach(async () => {
  await truncate(TABLES)
  for (const id of ['conn-1', 'conn-2', 'conn-3']) clusters[id] = { vnets: [], applies: 0, guests: [] }
  pveFetchMock.mockReset()
  pveFetchMock.mockImplementation(async (conn: any, path: string, init?: any) => fake(conn, path, init))
  const now = new Date()
  await prismaTest.tenant.createMany({
    data: [
      { id: 'tenant-a', slug: 'tenant-a', name: 'Acme', operatingModel: 'iaas', createdAt: now, updatedAt: now },
      { id: 'tenant-b', slug: 'tenant-b', name: 'Globex', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    ],
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: ['conn-1', 'conn-2', 'conn-3'].map((id, i) => ({ id, tenantId: 'default', name: ['paris', 'lyon', 'nice'][i], baseUrl: `https://${id}`, apiTokenEnc: 'enc' })),
    })
    await tx.providerConnection.createMany({ data: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }, { connectionId: 'conn-3' }] })
  })
  await prismaTest.sdnEvpnZone.create({
    data: {
      id: 'z1', name: 'Shared', zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9003,
      members: { create: [
        { id: 'm1', connectionId: 'conn-1', controller: 'evpn1', adopted: true },
        { id: 'm2', connectionId: 'conn-2', controller: 'evpn1', adopted: true },
      ] },
    },
  })
  const vdc = (id: string, tenantId: string, connectionId: string, name: string, over: Record<string, unknown> = {}) =>
    ({ id, tenantId, connectionId, name, slug: id, pvePoolName: `p-${id}`, sdnZoneName: `z${id}`.slice(0, 8), evpnZoneId: 'z1', ...over })
  await prismaTest.vdc.createMany({
    data: [
      vdc('a1', 'tenant-a', 'conn-1', 'Acme Paris', { sdnZoneName: null }),
      vdc('a2', 'tenant-a', 'conn-2', 'Acme Lyon'),
      // Not attached to the zone: never offered, never accepted.
      vdc('a3', 'tenant-a', 'conn-3', 'Acme Nice', { evpnZoneId: null }),
      vdc('b1', 'tenant-b', 'conn-1', 'Globex Paris'),
    ],
  })
})

const create = (over: Record<string, unknown> = {}) =>
  createEvpnNetworkForTenant({ vdcId: 'a1', tenantId: 'tenant-a', displayName: 'backbone', createdBy: 'user-1', ...over } as any)

describe('evpnContextForVdc', () => {
  it('offers the vDCs of the tenant attached to the same zone, and nothing of another tenant', async () => {
    await create()
    expect(await evpnContextForVdc('a1', 'tenant-a')).toEqual({
      available: true,
      vdcs: [{ id: 'a2', name: 'Acme Lyon' }, { id: 'a1', name: 'Acme Paris' }],
      networks: [{ id: expect.any(String), name: 'backbone', vdcIds: expect.arrayContaining(['a1', 'a2']) }],
    })
    expect((await evpnContextForVdc('b1', 'tenant-b')).networks).toEqual([])
    expect(await evpnContextForVdc('a3', 'tenant-a')).toEqual({ available: false, vdcs: [], networks: [] })
    await expect(evpnContextForVdc('b1', 'tenant-a')).rejects.toThrow('vDC not found')
  })
})

describe('createEvpnNetworkForTenant', () => {
  it('creates one network on every attached vDC by default: same VNI of the zone range, same PVE id, in the shared zone', async () => {
    const result = await create({ subnet: { cidr: '10.77.0.0/24', gateway: '10.77.0.1' } })
    expect(result.vni).toBe(9001)
    expect(result.vdcIds.sort()).toEqual(['a1', 'a2'])
    const [paris] = clusters['conn-1'].vnets
    const [lyon] = clusters['conn-2'].vnets
    expect(paris).toMatchObject({ zone: 'zshared', tag: 9001, alias: 'backbone' })
    expect(lyon).toMatchObject({ zone: 'zshared', tag: 9001, vnet: paris.vnet })
    expect(clusters['conn-1'].applies).toBe(1)
    expect(clusters['conn-3'].vnets).toEqual([])

    const vnets = await listVnetsForTenant('a2')
    expect(vnets).toHaveLength(1)
    expect(vnets[0]).toMatchObject({ displayName: 'backbone', tag: 9001, zoneName: 'zshared', tenantNetwork: { name: 'backbone', shared: true } })
    expect(vnets[0].subnet).toMatchObject({ cidr: '10.77.0.0/24', gateway: '10.77.0.1' })
    // The provider's list of stretched networks does not carry the tenant's own.
    expect(await listTenantNetworks()).toEqual([])
  })

  it('limits the network to the ticked vDCs, the current one always included, and allows a pure L2 network', async () => {
    const result = await create({ vdcIds: [] })
    expect(result.vdcIds).toEqual(['a1'])
    expect(clusters['conn-2'].vnets).toEqual([])
    expect((await listVnetsForTenant('a1'))[0].subnet).toBeNull()
  })

  it('takes the next free VNI of the range and refuses once the range is used up', async () => {
    clusters['conn-3'].vnets.push({ vnet: 'vhand', zone: 'zshared', tag: 9001 })
    expect((await create()).vni).toBe(9002)
    expect((await create({ displayName: 'second' })).vni).toBe(9003)
    await expect(create({ displayName: 'third' })).rejects.toMatchObject({ status: 409, message: 'No free VNI left in the shared zone. Ask your provider to extend it.' })
  })

  it('refuses a vDC of another tenant or outside the zone, without naming it', async () => {
    for (const foreign of ['b1', 'a3', 'ghost']) {
      await expect(create({ vdcIds: [foreign] })).rejects.toThrow('Tenant network: a selected vDC is not attached to the shared zone.')
    }
    await expect(createEvpnNetworkForTenant({ vdcId: 'a3', tenantId: 'tenant-a', displayName: 'x', createdBy: null }))
      .rejects.toThrow('this vDC is not attached to a shared zone')
    await expect(createEvpnNetworkForTenant({ vdcId: 'a1', tenantId: 'tenant-b', displayName: 'x', createdBy: null })).rejects.toThrow('vDC not found')
    expect(clusters['conn-1'].vnets).toEqual([])
  })

  it('checks the quota of every vDC before writing anything', async () => {
    await prismaTest.vdcQuota.create({ data: { id: 'q2', vdcId: 'a2', maxVnets: 0 } })
    await expect(create()).rejects.toThrow('Quota exceeded on vDC "Acme Lyon": max_vnets=0, current=0')
    expect(clusters['conn-1'].vnets).toEqual([])
    expect(await prismaTest.tenantNetwork.count()).toBe(0)
    // Left out of the selection, that vDC's quota does not count.
    expect((await create({ vdcIds: ['a1'] })).vdcIds).toEqual(['a1'])
  })

  it('refuses a duplicate name, an invalid name, a bad subnet, and a missing subnet on a platform edge', async () => {
    await create()
    await expect(create()).rejects.toThrow('VNet "backbone" already exists for this tenant')
    await prismaTest.vdcVnet.create({ data: { id: 'local', vdcId: 'a2', pveName: 'vlocal', displayName: 'lan', tag: 12000, type: 'vxlan' } })
    await expect(create({ displayName: 'lan' })).rejects.toThrow('VNet "lan" already exists in vDC "Acme Lyon"')
    await expect(create({ displayName: 'Bad Name' })).rejects.toThrow('Tenant network:')
    await expect(create({ displayName: 'x', subnet: { cidr: 'nope', gateway: '1.1.1.1' } })).rejects.toThrow('invalid CIDR')
    await prismaTest.vdc.update({ where: { id: 'a2' }, data: { edgeModel: 'platform' } })
    await expect(create({ displayName: 'x' })).rejects.toThrow('define the subnet')
  })

  it('leaves nothing behind when a cluster refuses the network', async () => {
    clusters['conn-2'].failVnetCreate = true
    await expect(create()).rejects.toThrow('Failed to create SDN VNet "backbone"')
    expect(clusters['conn-1'].vnets).toEqual([])
    expect(await prismaTest.tenantNetwork.count()).toBe(0)
    expect(await prismaTest.vdcVnet.count()).toBe(0)
  })
})

describe('setEvpnNetworkPresence', () => {
  it('adds the network where it is ticked and removes it where it is unticked', async () => {
    const { id } = await create({ vdcIds: ['a1'] })
    expect((await setEvpnNetworkPresence(id, 'tenant-a', ['a1', 'a2'])).vdcIds.sort()).toEqual(['a1', 'a2'])
    expect(clusters['conn-2'].vnets).toHaveLength(1)
    await setEvpnNetworkPresence(id, 'tenant-a', ['a2'])
    expect(clusters['conn-1'].vnets).toEqual([])
    expect((await prismaTest.tenantNetworkMember.findMany({ where: { tenantNetworkId: id } })).map(m => m.vdcId)).toEqual(['a2'])
  })

  it('refuses an empty selection, a foreign vDC, a full quota and a vDC whose guests still use the network', async () => {
    const { id } = await create()
    await expect(setEvpnNetworkPresence(id, 'tenant-a', [])).rejects.toThrow('must stay on at least one vDC')
    await expect(setEvpnNetworkPresence(id, 'tenant-a', ['a1', 'b1'])).rejects.toThrow('a selected vDC is not attached to the shared zone')
    await expect(setEvpnNetworkPresence(id, 'tenant-b', ['b1'])).rejects.toThrow('Tenant network: not found.')

    clusters['conn-2'].guests.push({ vmid: 101, bridge: clusters['conn-2'].vnets[0].vnet })
    await expect(setEvpnNetworkPresence(id, 'tenant-a', ['a1'])).rejects.toThrow('1 guest NIC(s) still use "backbone" on vDC "Acme Lyon"')

    clusters['conn-2'].guests = []
    await setEvpnNetworkPresence(id, 'tenant-a', ['a1'])
    await prismaTest.vdcQuota.create({ data: { id: 'q2', vdcId: 'a2', maxVnets: 0 } })
    await expect(setEvpnNetworkPresence(id, 'tenant-a', ['a1', 'a2'])).rejects.toThrow('Quota exceeded on vDC "Acme Lyon"')
  })
})

describe('through the tenant VNet API', () => {
  const input = { vdcId: 'a1', tenantId: 'tenant-a', displayName: 'backbone', createdBy: 'user-1' }

  it('creates a shared network from a VNet creation of type evpn, and refuses a chosen VNI', async () => {
    const vnet = await createVnetForTenant({ ...input, type: 'evpn', vdcIds: ['a1', 'a2'] })
    expect(vnet).toMatchObject({ displayName: 'backbone', tag: 9001, tenantNetwork: { shared: true } })
    expect(clusters['conn-2'].vnets).toHaveLength(1)
    await expect(createVnetForTenant({ ...input, displayName: 'other', type: 'evpn', vni: 9002 })).rejects.toThrow('the shared zone allocates the VNI')
  })

  it('a vDC without a zone of its own still refuses a plain VXLAN network', async () => {
    await expect(createVnetForTenant(input)).rejects.toThrow('VXLAN networks are unavailable on this vDC')
  })

  it('deleting the VNet takes the network off that vDC only, and deletes it with its last vDC', async () => {
    await createVnetForTenant({ ...input, type: 'evpn' })
    clusters['conn-1'].guests.push({ vmid: 100, bridge: clusters['conn-1'].vnets[0].vnet })
    expect(await deleteVnetForTenant('a1', 'tenant-a', 'backbone')).toEqual({ deleted: false, attachmentCount: 1 })

    clusters['conn-1'].guests = []
    expect(await deleteVnetForTenant('a1', 'tenant-a', 'backbone')).toEqual({ deleted: true })
    expect(clusters['conn-1'].vnets).toEqual([])
    expect(clusters['conn-2'].vnets).toHaveLength(1)
    expect(await prismaTest.tenantNetwork.count()).toBe(1)

    expect(await deleteVnetForTenant('a2', 'tenant-a', 'backbone')).toEqual({ deleted: true })
    expect(await prismaTest.tenantNetwork.count()).toBe(0)
  })

  it('the tenant edits its shared network; a DNS change reaches every vDC carrying it', async () => {
    await createVnetForTenant({ ...input, type: 'evpn', subnet: { cidr: '10.77.0.0/24', gateway: '10.77.0.1' } })
    const updated = await updateVnetForTenant('a1', 'tenant-a', 'backbone', { description: 'core', subnet: { dnsServers: ['9.9.9.9'] } })
    expect(updated).toMatchObject({ description: 'core', tenantNetwork: { shared: true } })
    expect((await listVnetsForTenant('a2'))[0].subnet?.dnsServers).toEqual(['9.9.9.9'])
    expect((await prismaTest.vdcSubnet.findMany()).every(s => s.dnsServers === '9.9.9.9')).toBe(true)
  })
})

describe('zone and vDC guards', () => {
  it('a vDC attaches only to a zone its cluster carries, and detaches once it carries none of its networks', async () => {
    expect((await assertEvpnZoneForCluster('z1', 'conn-1')).zoneName).toBe('zshared')
    await expect(assertEvpnZoneForCluster('z1', 'conn-3')).rejects.toThrow('"Shared" is not carried by the cluster of this vDC')
    await expect(assertEvpnZoneForCluster('ghost', 'conn-1')).rejects.toThrow('EVPN zone: not found.')

    await create()
    await expect(assertEvpnDetachSafe('a1')).rejects.toThrow('still carries 1 network(s) of the zone')
    await expect(assertEvpnDetachSafe('a3')).resolves.toBeUndefined()
    expect(await attachedVdcCount('z1')).toBe(3)
    expect(await attachedVdcCount('z1', 'conn-2')).toBe(1)
  })

  it('a zone with attached vDCs cannot be deleted, and its range must keep the networks it holds', async () => {
    await expect(deleteEvpnZone('z1')).rejects.toThrow('3 vDC(s) are still attached to "Shared". Detach them first.')
    await create()
    await expect(updateEvpnZone('z1', { vniStart: 9002, vniEnd: 9099 })).rejects.toThrow('must still hold VNI 9001 of network "backbone"')
    expect(await updateEvpnZone('z1', { vniEnd: 9099 })).toMatchObject({ vniEnd: 9099, vdcCount: 3, networkCount: 1 })
  })
})
