/**
 * Postgres-backed tests for the provider EVPN zones (#1334). Proxmox is a
 * small in-memory fake per cluster: controllers, zones and VNets, with the
 * writes ProxCenter stages and the SDN applies it triggers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

interface FakeCluster {
  controllers: any[]
  zones: any[]
  vnets: any[]
  applies: number
  frr: 'Installed' | 'NotInstalled'
  down?: boolean
  failApply?: boolean
  failZoneCreate?: boolean
}

const clusters: Record<string, FakeCluster> = {}

function fake(conn: any, path: string, init: any = {}): any {
  const c = clusters[conn.id]
  if (!c || c.down) throw new Error('connect ECONNREFUSED')
  const method = init.method ?? 'GET'
  const body: URLSearchParams | undefined = init.body
  const [route] = path.split('?')
  if (route === '/cluster/sdn/controllers' && method === 'GET') return c.controllers
  if (route === '/cluster/sdn/controllers' && method === 'POST') {
    c.controllers.push({ controller: body!.get('controller'), type: body!.get('type'), asn: Number(body!.get('asn')), peers: body!.get('peers') })
    return null
  }
  if (route.startsWith('/cluster/sdn/controllers/') && method === 'DELETE') {
    c.controllers = c.controllers.filter(x => x.controller !== decodeURIComponent(route.split('/').pop()!))
    return null
  }
  if (route === '/cluster/sdn/zones' && method === 'GET') return c.zones
  if (route === '/cluster/sdn/zones' && method === 'POST') {
    if (c.failZoneCreate) throw new Error('400 zone refused')
    const zone: any = { zone: body!.get('zone'), type: body!.get('type'), controller: body!.get('controller'), 'vrf-vxlan': Number(body!.get('vrf-vxlan')), state: 'new' }
    if (body!.get('mtu')) zone.mtu = Number(body!.get('mtu'))
    c.zones.push(zone)
    return null
  }
  if (route.startsWith('/cluster/sdn/zones/') && method === 'DELETE') {
    c.zones = c.zones.filter(x => x.zone !== decodeURIComponent(route.split('/').pop()!))
    return null
  }
  if (route === '/cluster/sdn/vnets') return c.vnets
  if (route === '/cluster/sdn' && method === 'PUT') {
    if (c.failApply) throw new Error('ifreload failed')
    c.applies++
    for (const z of c.zones) delete z.state
    return null
  }
  if (route === '/cluster/status') return [{ type: 'cluster', name: conn.id }, { type: 'node', name: 'n1', ip: `10.0.${conn.id === 'conn-1' ? 1 : 2}.1` }]
  if (route === '/nodes') return [{ node: 'n1' }]
  if (route === '/nodes/n1/apt/versions') return [{ Package: 'pve-manager', CurrentState: 'Installed' }, { Package: 'frr-pythontools', CurrentState: c.frr }]
  throw new Error(`unexpected PVE call ${method} ${path}`)
}

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: `https://${id}`, apiToken: 'tok' }) }))

import {
  addEvpnZoneMember,
  createEvpnZone,
  deleteEvpnZone,
  discoverEvpn,
  getEvpnZoneStatus,
  listEvpnZones,
  removeEvpnZoneMember,
  resyncEvpnZoneMember,
  updateEvpnZone,
  type CreateEvpnZoneInput,
} from './evpnZones'

const TABLES = ['sdn_evpn_zone_members', 'sdn_evpn_zones', 'tenant_network_members', 'tenant_networks', 'vdc_vnets', 'vdcs', 'provider_connections', 'Connection', 'tenants']

const existing = (name = 'evpn1') => ({ mode: 'existing' as const, name })
const input = (over: Partial<CreateEvpnZoneInput> = {}): CreateEvpnZoneInput => ({
  name: 'Shared', zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9099,
  members: [{ connectionId: 'conn-1', controller: existing() }, { connectionId: 'conn-2', controller: existing() }],
  ...over,
})

beforeEach(async () => {
  await truncate(TABLES)
  for (const id of ['conn-1', 'conn-2']) {
    clusters[id] = { controllers: [{ controller: 'evpn1', type: 'evpn', asn: 65000, peers: '10.0.1.1,10.0.2.1' }], zones: [], vnets: [], applies: 0, frr: 'Installed' }
  }
  pveFetchMock.mockReset()
  pveFetchMock.mockImplementation(async (conn: any, path: string, init?: any) => fake(conn, path, init))
  const now = new Date()
  await prismaTest.tenant.create({ data: { id: 'tenant-a', slug: 'tenant-a', name: 'A', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn-1', tenantId: 'default', name: 'paris', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-2', tenantId: 'default', name: 'lyon', baseUrl: 'https://pve2', apiTokenEnc: 'enc' },
        { id: 'pbs-1', tenantId: 'default', name: 'pbs', type: 'pbs', baseUrl: 'https://pbs', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({ data: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }] })
  })
})

describe('createEvpnZone', () => {
  it('creates the zone on every cluster, bound to the chosen controller, and applies once per cluster', async () => {
    const { zone, applyErrors } = await createEvpnZone(input(), 'admin-1')
    expect(applyErrors).toEqual([])
    expect(zone).toMatchObject({ name: 'Shared', zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9099 })
    expect(zone.members.map(m => [m.connectionName, m.controller, m.controllerCreated, m.adopted])).toEqual([
      ['paris', 'evpn1', false, false], ['lyon', 'evpn1', false, false],
    ])
    for (const id of ['conn-1', 'conn-2']) {
      expect(clusters[id].zones).toEqual([{ zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000, mtu: 1450 }])
      expect(clusters[id].applies).toBe(1)
    }
    expect(await listEvpnZones()).toHaveLength(1)
  })

  it('adopts a zone Proxmox already runs without writing or applying anything there', async () => {
    clusters['conn-1'].zones.push({ zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000, mtu: 1450 })
    clusters['conn-1'].vnets.push({ vnet: 'vold', zone: 'zshared', tag: 9001 })
    const { zone } = await createEvpnZone(input(), null)
    expect(zone.members.map(m => m.adopted)).toEqual([true, false])
    expect(clusters['conn-1'].applies).toBe(0)
    expect(clusters['conn-2'].applies).toBe(1)
  })

  it('creates a simple controller where the provider asks for one', async () => {
    clusters['conn-2'].controllers = []
    const { zone } = await createEvpnZone(input({
      members: [
        { connectionId: 'conn-1', controller: existing() },
        { connectionId: 'conn-2', controller: { mode: 'create', name: 'evpnpxc', asn: 65000, peers: ['10.0.1.1', '10.0.2.1'] } },
      ],
    }), null)
    expect(clusters['conn-2'].controllers).toEqual([{ controller: 'evpnpxc', type: 'evpn', asn: 65000, peers: '10.0.1.1,10.0.2.1' }])
    expect(zone.members[1]).toMatchObject({ controller: 'evpnpxc', controllerCreated: true })
    expect(clusters['conn-2'].zones[0].controller).toBe('evpnpxc')
  })

  it('refuses an adoption whose VRF VNI, controller or MTU differ', async () => {
    clusters['conn-1'].zones.push({ zone: 'zshared', type: 'evpn', controller: 'other', 'vrf-vxlan': 9000, mtu: 1450 })
    await expect(createEvpnZone(input(), null)).rejects.toThrow('is bound to controller "other"')
    clusters['conn-1'].zones[0] = { zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 8000, mtu: 1450 }
    await expect(createEvpnZone(input(), null)).rejects.toThrow('uses VRF VNI 8000, not 9000')
    clusters['conn-1'].zones[0] = { zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000 }
    await expect(createEvpnZone(input(), null)).rejects.toThrow('has MTU default, not 1450')
    expect(clusters['conn-2'].zones).toEqual([])
  })

  it('refuses a zone id another zone type holds, a missing controller and a controller to create that exists', async () => {
    clusters['conn-1'].zones.push({ zone: 'zshared', type: 'vxlan' })
    await expect(createEvpnZone(input(), null)).rejects.toThrow('already has a vxlan zone "zshared"')
    clusters['conn-1'].zones = []
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: existing('ghost') }] }), null))
      .rejects.toThrow('has no EVPN controller "ghost"')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { mode: 'create', name: 'evpn1', asn: 65000, peers: ['10.0.1.1'] } }] }), null))
      .rejects.toThrow('select it instead of creating it')
  })

  it('refuses a cluster whose nodes miss frr, and one that cannot be read', async () => {
    clusters['conn-2'].frr = 'NotInstalled'
    await expect(createEvpnZone(input(), null)).rejects.toThrow('the frr packages are missing on n1 of cluster "lyon"')
    clusters['conn-2'].down = true
    await expect(createEvpnZone(input(), null)).rejects.toThrow('cluster "lyon" cannot be read')
    expect(clusters['conn-1'].zones).toEqual([])
  })

  it('undoes what it staged when one cluster refuses, and applies nowhere', async () => {
    clusters['conn-2'].failZoneCreate = true
    clusters['conn-2'].controllers = []
    await expect(createEvpnZone(input({
      members: [
        { connectionId: 'conn-1', controller: existing() },
        { connectionId: 'conn-2', controller: { mode: 'create', name: 'evpnpxc', asn: 65000, peers: ['10.0.2.1'] } },
      ],
    }), null)).rejects.toThrow('Failed to create SDN zone "zshared"')
    expect(clusters['conn-1'].zones).toEqual([])
    expect(clusters['conn-2'].controllers).toEqual([])
    expect(clusters['conn-1'].applies + clusters['conn-2'].applies).toBe(0)
    expect(await listEvpnZones()).toEqual([])
  })

  it('keeps the zone and reports the cluster when the apply fails', async () => {
    clusters['conn-2'].failApply = true
    const { zone, applyErrors } = await createEvpnZone(input(), null)
    expect(zone.members).toHaveLength(2)
    expect(applyErrors).toEqual([{ connectionName: 'lyon', error: 'ifreload failed' }])
  })

  it('validates the form', async () => {
    await expect(createEvpnZone(input({ name: ' ' }), null)).rejects.toThrow('the name is required')
    await expect(createEvpnZone(input({ zoneName: 'Bad-Zone' }), null)).rejects.toThrow('the Proxmox zone id must be')
    await expect(createEvpnZone(input({ vrfVxlan: 0 }), null)).rejects.toThrow('the VRF VNI must be an integer')
    await expect(createEvpnZone(input({ mtu: 100 }), null)).rejects.toThrow('MTU must be an integer')
    await expect(createEvpnZone(input({ vniStart: 50, vniEnd: 10 }), null)).rejects.toThrow('starts at 50, above its end 10')
    await expect(createEvpnZone(input({ vrfVxlan: 9050 }), null)).rejects.toThrow('must stay outside the VNI range')
    await expect(createEvpnZone(input({ members: [] }), null)).rejects.toThrow('select at least one cluster')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: existing() }, { connectionId: 'conn-1', controller: existing() }] }), null))
      .rejects.toThrow('listed twice')
    await expect(createEvpnZone(input({ members: [{ connectionId: '', controller: existing() }] }), null)).rejects.toThrow('missing its id')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { mode: 'existing', name: 'Bad Name' } }] }), null))
      .rejects.toThrow('a controller id must be')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { name: 'evpn1' } as any }] }), null))
      .rejects.toThrow('needs an EVPN controller')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { mode: 'create', name: 'evpn2', asn: 0, peers: ['10.0.1.1'] } }] }), null))
      .rejects.toThrow('the AS number must be')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { mode: 'create', name: 'evpn2', asn: 65000, peers: ['nope'] } }] }), null))
      .rejects.toThrow('is not a valid IPv4 or IPv6 address')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: { mode: 'create', name: 'evpn2', asn: 65000, peers: [] } }] }), null))
      .rejects.toThrow('at least one peer address')
    await expect(createEvpnZone(input({ members: [{ connectionId: 'pbs-1', controller: existing() }] }), null)).rejects.toThrow('cluster not found')
  })

  it('refuses a name, a zone id, a range or a VRF VNI another zone holds', async () => {
    await createEvpnZone(input(), null)
    await expect(createEvpnZone(input({ zoneName: 'zother', vrfVxlan: 8000, vniStart: 8001, vniEnd: 8099 }), null)).rejects.toThrow('a zone named "Shared" already exists')
    const other = { name: 'Other', zoneName: 'zother' }
    await expect(createEvpnZone(input({ name: 'Other', vrfVxlan: 8000, vniStart: 8001, vniEnd: 8099 }), null)).rejects.toThrow('"zshared" is already declared by zone "Shared"')
    await expect(createEvpnZone(input({ ...other, vrfVxlan: 8000, vniStart: 9090, vniEnd: 9200 }), null)).rejects.toThrow('overlaps the range 9001-9099 of EVPN zone "Shared"')
    await expect(createEvpnZone(input({ ...other, vrfVxlan: 9000, vniStart: 8001, vniEnd: 8099 }), null)).rejects.toThrow('VRF VNI 9000 is already reserved by EVPN zone "Shared"')
    await expect(createEvpnZone(input({ ...other, vrfVxlan: 9050, vniStart: 8001, vniEnd: 8099 }), null)).rejects.toThrow('VRF VNI 9050 is already reserved by EVPN zone "Shared"')
    await expect(createEvpnZone(input({ ...other, vrfVxlan: 7000, vniStart: 8990, vniEnd: 9000 }), null)).rejects.toThrow('contains the VRF VNI 9000 of EVPN zone "Shared"')
  })

  it('refuses a range or a VRF VNI the vDCs or their networks already hold', async () => {
    await prismaTest.vdc.create({ data: { id: 'vdc-a', tenantId: 'tenant-a', connectionId: 'conn-1', name: 'vdc-a', slug: 'a', pvePoolName: 'pa', sdnZoneName: 'za', vniRangeStart: 20000, vniRangeEnd: 20099 } })
    await prismaTest.vdcVnet.create({ data: { id: 'vn-1', vdcId: 'vdc-a', pveName: 'vlan1', displayName: 'lan', tag: 9010, type: 'vxlan' } })
    await expect(createEvpnZone(input(), null)).rejects.toThrow('VNI 9010 of the range is already used by network "lan" of vDC "vdc-a"')
    await expect(createEvpnZone(input({ vrfVxlan: 9010, vniStart: 9100, vniEnd: 9199 }), null)).rejects.toThrow('the VRF VNI 9010 is already used by network "lan"')
    await expect(createEvpnZone(input({ vrfVxlan: 8000, vniStart: 20050, vniEnd: 20150 }), null)).rejects.toThrow('overlaps the range 20000-20099 of vDC "vdc-a"')
    await expect(createEvpnZone(input({ vrfVxlan: 20001, vniStart: 9100, vniEnd: 9199 }), null)).rejects.toThrow('is inside the range 20000-20099 of vDC "vdc-a"')
  })
})

describe('members', () => {
  it('extends the zone to one more cluster and refuses a cluster that already carries it', async () => {
    const { zone } = await createEvpnZone(input({ members: [{ connectionId: 'conn-1', controller: existing() }] }), null)
    const added = await addEvpnZoneMember(zone.id, { connectionId: 'conn-2', controller: existing() })
    expect(added.zone.members.map(m => m.connectionName)).toEqual(['paris', 'lyon'])
    expect(clusters['conn-2'].zones).toHaveLength(1)
    expect(clusters['conn-2'].applies).toBe(1)
    await expect(addEvpnZoneMember(zone.id, { connectionId: 'conn-2', controller: existing() })).rejects.toThrow('already carries the zone')
    await expect(addEvpnZoneMember('ghost', { connectionId: 'conn-2', controller: existing() })).rejects.toThrow('EVPN zone: not found')
  })

  it('deletes a zone it created when the cluster is detached, once it holds no VNet', async () => {
    const { zone } = await createEvpnZone(input(), null)
    clusters['conn-2'].vnets.push({ vnet: 'v1', zone: 'zshared', tag: 9001 })
    await expect(removeEvpnZoneMember(zone.id, 'conn-2')).rejects.toThrow('still holds 1 VNet(s) on cluster "lyon"')
    clusters['conn-2'].vnets = []
    const result = await removeEvpnZoneMember(zone.id, 'conn-2')
    expect(result.zone.members.map(m => m.connectionName)).toEqual(['paris'])
    expect(clusters['conn-2'].zones).toEqual([])
    expect(clusters['conn-2'].controllers).toHaveLength(1)
    await expect(removeEvpnZoneMember(zone.id, 'conn-2')).rejects.toThrow('does not carry the zone')
  })

  it('leaves an adopted zone in place, and reports an apply that failed', async () => {
    clusters['conn-1'].zones.push({ zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000, mtu: 1450 })
    const { zone } = await createEvpnZone(input(), null)
    await removeEvpnZoneMember(zone.id, 'conn-1')
    expect(clusters['conn-1'].zones).toHaveLength(1)
    clusters['conn-2'].failApply = true
    const errors = await deleteEvpnZone(zone.id)
    expect(errors).toEqual([{ connectionName: 'lyon', error: 'ifreload failed' }])
    expect(await listEvpnZones()).toEqual([])
  })
})

describe('updateEvpnZone', () => {
  it('renames, describes and moves the range, against the same reservations', async () => {
    const { zone } = await createEvpnZone(input(), null)
    await createEvpnZone(input({ name: 'Other', zoneName: 'zother', vrfVxlan: 8000, vniStart: 8001, vniEnd: 8099 }), null)
    const updated = await updateEvpnZone(zone.id, { name: 'Renamed', description: ' core ', vniStart: 9001, vniEnd: 9199 })
    expect(updated).toMatchObject({ name: 'Renamed', description: 'core', vniStart: 9001, vniEnd: 9199 })
    await expect(updateEvpnZone(zone.id, { name: 'Other' })).rejects.toThrow('a zone named "Other" already exists')
    await expect(updateEvpnZone(zone.id, { vniStart: 8090, vniEnd: 8095 })).rejects.toThrow('overlaps the range 8001-8099 of EVPN zone "Other"')
    expect((await updateEvpnZone(zone.id, { description: '' })).description).toBeNull()
  })

  it('reads no cluster when the range sent back is the one already set (issue #1360)', async () => {
    const { zone } = await createEvpnZone(input(), null)
    pveFetchMock.mockClear()
    const updated = await updateEvpnZone(zone.id, { name: 'Same range', vniStart: zone.vniStart, vniEnd: zone.vniEnd })
    expect(updated).toMatchObject({ name: 'Same range', vniStart: zone.vniStart, vniEnd: zone.vniEnd })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('status and resync', () => {
  it('reports how each cluster runs the zone', async () => {
    const { zone } = await createEvpnZone(input(), null)
    clusters['conn-1'].vnets.push({ vnet: 'v1', zone: 'zshared', tag: 9001 })
    expect(await getEvpnZoneStatus(zone.id)).toEqual([
      { connectionId: 'conn-1', connectionName: 'paris', state: 'ok', detail: null, vnetCount: 1 },
      { connectionId: 'conn-2', connectionName: 'lyon', state: 'ok', detail: null, vnetCount: 0 },
    ])
    clusters['conn-1'].zones[0].state = 'changed'
    clusters['conn-2'].zones[0]['vrf-vxlan'] = 7000
    clusters['conn-2'].zones[0].mtu = 1400
    let status = await getEvpnZoneStatus(zone.id)
    expect(status.map(s => [s.state, s.detail])).toEqual([['pending', null], ['drift', 'VRF VNI 7000, MTU 1400']])
    clusters['conn-1'].zones = []
    clusters['conn-2'].zones[0] = { zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000, mtu: 1450 }
    clusters['conn-2'].controllers = []
    status = await getEvpnZoneStatus(zone.id)
    expect(status.map(s => [s.state, s.detail])).toEqual([['missing', null], ['controller-missing', 'evpn1']])
    clusters['conn-2'].down = true
    expect((await getEvpnZoneStatus(zone.id))[1].state).toBe('unreachable')
  })

  it('recreates a zone that is gone and applies a staged change, but never rewrites a drift', async () => {
    const { zone } = await createEvpnZone(input(), null)
    clusters['conn-1'].zones = []
    expect((await resyncEvpnZoneMember(zone.id, 'conn-1')).state).toBe('ok')
    expect(clusters['conn-1'].zones).toEqual([{ zone: 'zshared', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 9000, mtu: 1450 }])
    expect(clusters['conn-1'].applies).toBe(2)

    clusters['conn-1'].zones[0].state = 'changed'
    expect((await resyncEvpnZoneMember(zone.id, 'conn-1')).state).toBe('ok')
    expect(clusters['conn-1'].applies).toBe(3)
    await resyncEvpnZoneMember(zone.id, 'conn-1')
    expect(clusters['conn-1'].applies).toBe(3)

    clusters['conn-2'].zones[0].controller = 'other'
    await expect(resyncEvpnZoneMember(zone.id, 'conn-2')).rejects.toThrow('differs on cluster "lyon" (controller other): fix it in Proxmox')
    clusters['conn-2'].zones[0].controller = 'evpn1'
    clusters['conn-2'].controllers = []
    await expect(resyncEvpnZoneMember(zone.id, 'conn-2')).rejects.toThrow('controller "evpn1" no longer exists')
    clusters['conn-2'].down = true
    await expect(resyncEvpnZoneMember(zone.id, 'conn-2')).rejects.toThrow('cluster "lyon" cannot be reached')
    await expect(resyncEvpnZoneMember(zone.id, 'nope')).rejects.toThrow('does not carry the zone')
  })
})

describe('discoverEvpn', () => {
  it('lists the controllers, the EVPN zones, the node addresses and the nodes missing frr', async () => {
    clusters['conn-1'].zones.push({ zone: 'zold', type: 'evpn', controller: 'evpn1', 'vrf-vxlan': 5000 }, { zone: 'zvx', type: 'vxlan' })
    clusters['conn-2'].frr = 'NotInstalled'
    const found = await discoverEvpn(['conn-1', 'conn-2', 'pbs-1'])
    expect(found.map(f => f.connectionName)).toEqual(['lyon', 'paris'])
    expect(found[1]).toEqual({
      connectionId: 'conn-1', connectionName: 'paris', reachable: true,
      controllers: [{ controller: 'evpn1', asn: 65000, peers: ['10.0.1.1', '10.0.2.1'] }],
      zones: [{ zone: 'zold', controller: 'evpn1', vrfVxlan: 5000, mtu: null, state: null }],
      nodeIps: ['10.0.1.1'], nodesWithoutFrr: [],
    })
    expect(found[0].nodesWithoutFrr).toEqual(['n1'])
    clusters['conn-1'].down = true
    expect((await discoverEvpn(['conn-1']))[0]).toMatchObject({ reachable: false, controllers: [], zones: [] })
  })
})
