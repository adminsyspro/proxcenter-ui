/**
 * Postgres-backed tests for the transport-scoped VNI choice (roadmap#18).
 * The PVE client is mocked: the live tag set comes from the mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { DEFAULT_TRANSPORT, type VdcTransport } from './transport'
import { normalizeRequestedVni, pickVni, takenVnisOnTransport, VniError } from './vniPolicy'

const TABLES = ['tenant_network_members', 'tenant_networks', 'vdc_vnets', 'vdcs', 'provider_connections', 'Connection', 'tenants']
const conn = { baseUrl: 'https://pve.test', apiToken: 'tok' }

beforeEach(async () => {
  await truncate(TABLES)
  pveFetchMock.mockReset()
  pveFetchMock.mockResolvedValue([])
  const now = new Date()
  await prismaTest.tenant.createMany({
    data: [
      { id: 'tenant-a', slug: 'tenant-a', name: 'A', operatingModel: 'iaas', createdAt: now, updatedAt: now },
      { id: 'tenant-b', slug: 'tenant-b', name: 'B', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    ],
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn-1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-2', tenantId: 'default', name: 'pve-2', baseUrl: 'https://pve2', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({ data: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }] })
  })
  await prismaTest.vdc.createMany({
    data: [
      { id: 'vdc-a', tenantId: 'tenant-a', connectionId: 'conn-1', name: 'vdc-a', slug: 'a', pvePoolName: 'pa', sdnZoneName: 'za' },
      { id: 'vdc-b', tenantId: 'tenant-b', connectionId: 'conn-1', name: 'vdc-b', slug: 'b', pvePoolName: 'pb', sdnZoneName: 'zb' },
      { id: 'vdc-c', tenantId: 'tenant-a', connectionId: 'conn-2', name: 'vdc-c', slug: 'c', pvePoolName: 'pc', sdnZoneName: 'zc' },
    ],
  })
})

async function vnet(vdcId: string, pveName: string, tag: number, displayName = pveName, type = 'vxlan') {
  await prismaTest.vdcVnet.create({ data: { id: `${vdcId}-${pveName}`, vdcId, pveName, displayName, tag, type } })
}

const shared = (start: number | null = null, end: number | null = null): VdcTransport =>
  ({ ...DEFAULT_TRANSPORT, vniRangeStart: start, vniRangeEnd: end })
const dedicated: VdcTransport = { ...DEFAULT_TRANSPORT, mode: 'peers', peers: ['10.0.0.1'], sharing: 'dedicated' }

describe('normalizeRequestedVni', () => {
  it('accepts numbers and numeric strings, null for absent, 400 for the rest', () => {
    expect(normalizeRequestedVni(undefined)).toBeNull()
    expect(normalizeRequestedVni('')).toBeNull()
    expect(normalizeRequestedVni(' 42 ')).toBe(42)
    expect(normalizeRequestedVni(16777215)).toBe(16777215)
    for (const bad of [0, 16777216, 1.5, 'abc']) {
      try {
        normalizeRequestedVni(bad)
        throw new Error('expected a VniError')
      } catch (e: any) {
        expect(e).toBeInstanceOf(VniError)
        expect(e.status).toBe(400)
      }
    }
  })
})

describe('takenVnisOnTransport', () => {
  it('unions the vDCs of the connection, the stretched networks and the live overlay zones only', async () => {
    await vnet('vdc-a', 'va', 10000, 'lan')
    await vnet('vdc-b', 'vb', 10001, 'dmz')
    await vnet('vdc-b', 'vv', 300, 'vl', 'vlan')
    await vnet('vdc-c', 'vc', 10002, 'other-cluster')
    await prismaTest.tenantNetwork.create({ data: { id: 'tn', tenantId: 'tenant-a', name: 'stretch', pveName: 'vstretch', vni: 50000, updatedAt: new Date() } })
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/sdn/zones') return [{ zone: 'legacy', type: 'vxlan' }, { zone: 'vl', type: 'vlan' }, { zone: 'ev', type: 'evpn' }]
      if (path === '/cluster/sdn/vnets') return [
        { vnet: 'old', zone: 'legacy', tag: 777 }, { vnet: 'vlan1', zone: 'vl', tag: 200 }, { vnet: 'e1', zone: 'ev', tag: 888 },
      ]
      return []
    })

    const taken = await takenVnisOnTransport('conn-1', conn)
    expect([...taken.keys()].sort((x, y) => x - y)).toEqual([777, 888, 10000, 10001, 50000])
    expect(taken.get(10000)).toBe('network "lan" of vDC "vdc-a"')
    expect(taken.get(50000)).toBe('tenant network "stretch"')
    expect(taken.get(777)).toBe('VNet "old" of zone "legacy" on the cluster')
  })

  it('survives an unreachable cluster', async () => {
    await vnet('vdc-a', 'va', 10000)
    pveFetchMock.mockRejectedValue(new Error('timeout'))
    expect([...(await takenVnisOnTransport('conn-1', conn)).keys()]).toEqual([10000])
  })
})

describe('pickVni', () => {
  const base = { vdcId: 'vdc-a', connectionId: 'conn-1', conn }

  it('shared without a range: automatic only, historical allocator', async () => {
    await vnet('vdc-b', 'vb', 10000)
    expect(await pickVni({ ...base, transport: shared(), requested: null })).toBe(10001)
    await expect(pickVni({ ...base, transport: shared(), requested: 20000 })).rejects.toMatchObject({ status: 400 })
  })

  it('shared with a range: first free inside, requested checked against range and holders', async () => {
    await vnet('vdc-b', 'vb', 20000)
    const transport = shared(20000, 20002)
    expect(await pickVni({ ...base, transport, requested: null })).toBe(20001)
    await expect(pickVni({ ...base, transport, requested: 19999 })).rejects.toMatchObject({ status: 400 })
    await expect(pickVni({ ...base, transport, requested: 20000 })).rejects.toMatchObject({ status: 409 })
    expect(await pickVni({ ...base, transport, requested: 20002 })).toBe(20002)
    await vnet('vdc-a', 'x1', 20001)
    await vnet('vdc-a', 'x2', 20002)
    await expect(pickVni({ ...base, transport, requested: null })).rejects.toMatchObject({ status: 409 })
  })

  it('dedicated: free choice, collision on the cluster still refused, automatic falls back to the allocator', async () => {
    await vnet('vdc-b', 'vb', 10000)
    expect(await pickVni({ ...base, transport: dedicated, requested: 5 })).toBe(5)
    await expect(pickVni({ ...base, transport: dedicated, requested: 10000 })).rejects.toThrow(/already in use on this transport/)
    expect(await pickVni({ ...base, transport: dedicated, requested: null })).toBe(10001)
  })

  it('the ranges handed to the other vDCs of the cluster are reserved: skipped by the allocator, refused as a choice', async () => {
    await prismaTest.vdc.update({ where: { id: 'vdc-b' }, data: { vniRangeStart: 10000, vniRangeEnd: 10003 } })
    await vnet('vdc-b', 'vb', 10000)
    // vdc-a has no range: next above the max (10001) sits inside vdc-b's range, jump past it.
    expect(await pickVni({ ...base, transport: shared(), requested: null })).toBe(10004)
    // vdc-a dedicated: a choice inside vdc-b's range is a collision.
    await expect(pickVni({ ...base, transport: dedicated, requested: 10002 }))
      .rejects.toThrow(/already in use on this transport by the VNI range 10000-10003 assigned to vDC "vdc-b"/)
  })

  it('a VNI held on another cluster does not block this transport', async () => {
    await vnet('vdc-c', 'vc', 20000)
    expect(await pickVni({ ...base, transport: shared(20000, 20005), requested: 20000 })).toBe(20000)
  })
})
