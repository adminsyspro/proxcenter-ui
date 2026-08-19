/**
 * Postgres-backed tests for the vDC teardown VNet/zone restructure in
 * `deleteVdc` (index.ts, step 3 + step 5): every VNet of the vDC must be
 * deleted regardless of which zone it lives in (VXLAN zone owned by the
 * vDC, or a shared VLAN zone), and a shared VLAN zone (sdn_vlan_zones) must
 * never be deleted from here.
 *
 * `@/lib/connections/getConnection` is mocked because the real
 * `getConnectionById` decrypts `apiTokenEnc` and would throw on the fake
 * "enc" value used by the fixtures. `@/lib/proxmox/client` is mocked and
 * routed by URL/method so the test can assert exactly which PVE endpoints
 * were hit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const { pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getConnectionByIdMock: vi.fn(async () => ({ id: 'conn1' })),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))

import { deleteVdc } from './index'

const TABLES = ['vdc_vnets', 'sdn_vlan_zones', 'vdcs', 'provider_connections', 'Connection', 'tenants']

beforeEach(async () => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockClear()
  await truncate(TABLES)

  // GET /pools/... -> no VM members (delete is never blocked). All DELETEs
  // and the PUT /cluster/sdn (applySdn) succeed. Any other GET (e.g. the
  // vnet subnets lookup inside deleteVnetPve) falls back to an empty array.
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init: any = {}) => {
    const method = String(init?.method || 'GET').toUpperCase()
    if (method === 'GET' && path.startsWith('/pools/')) return { members: [] }
    if (method === 'DELETE') return {}
    if (method === 'PUT' && path === '/cluster/sdn') return {}
    return []
  })

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  // vdc.connectionId is an FK to provider_connections; the connection + pool
  // row must land in the same transaction (deferred pool-sync trigger).
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
  })
})

function deleteCalls(pathPredicate: (p: string) => boolean) {
  return pveFetchMock.mock.calls.filter(([, path, init]: any[]) =>
    String(init?.method || 'GET').toUpperCase() === 'DELETE' && pathPredicate(path)
  )
}

function putCalls(pathPredicate: (p: string) => boolean) {
  return pveFetchMock.mock.calls.filter(([, path, init]: any[]) =>
    String(init?.method || 'GET').toUpperCase() === 'PUT' && pathPredicate(path)
  )
}

interface VdcOpts {
  id: string
  sdnZoneName?: string | null
}

async function addVdc(opts: VdcOpts): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: 'tenant-1',
      connectionId: 'conn1',
      name: opts.id,
      slug: opts.id,
      pvePoolName: `pool-${opts.id}`,
      sdnZoneName: opts.sdnZoneName ?? null,
    },
  })
}

interface VnetOpts {
  id: string
  vdcId: string
  pveName: string
  type: string
  tag: number
  bridge?: string | null
  zoneName?: string | null
}

async function addVnet(opts: VnetOpts): Promise<void> {
  await prismaTest.vdcVnet.create({
    data: {
      id: opts.id,
      vdcId: opts.vdcId,
      pveName: opts.pveName,
      displayName: opts.pveName,
      type: opts.type,
      tag: opts.tag,
      bridge: opts.bridge ?? null,
      zoneName: opts.zoneName ?? null,
    },
  })
}

describe('deleteVdc VNet/zone teardown', () => {
  it('deletes a VLAN VNet even when the vDC owns no VXLAN zone, and never touches the shared VLAN zone', async () => {
    const sharedZone = 'vl1a2b3c'
    await prismaTest.sdnVlanZone.create({
      data: { id: 'z1', connectionId: 'conn1', bridge: 'vmbr0', zoneName: sharedZone },
    })
    await addVdc({ id: 'vdc-1', sdnZoneName: null })
    await addVnet({
      id: 'v1', vdcId: 'vdc-1', pveName: 'vaaaaaaa', type: 'vlan', tag: 150,
      bridge: 'vmbr0', zoneName: sharedZone,
    })

    await deleteVdc('vdc-1')

    // The VLAN vnet itself must be deleted on PVE.
    expect(deleteCalls((p) => p === '/cluster/sdn/vnets/vaaaaaaa')).toHaveLength(1)
    // The shared zone (or any zone) must NEVER be deleted: vdc.sdnZoneName is null.
    expect(deleteCalls((p) => p.startsWith('/cluster/sdn/zones/'))).toHaveLength(0)
    expect(deleteCalls((p) => p === `/cluster/sdn/zones/${sharedZone}`)).toHaveLength(0)
    // A vnet was touched -> applySdn must still run.
    expect(putCalls((p) => p === '/cluster/sdn')).toHaveLength(1)
  })

  it('deletes both vnets and the VXLAN zone of a mixed vDC, but leaves the shared VLAN zone untouched', async () => {
    const sharedZone = 'vl9z8y7x'
    const ownZone = 'zacme123'
    await prismaTest.sdnVlanZone.create({
      data: { id: 'z1', connectionId: 'conn1', bridge: 'vmbr0', zoneName: sharedZone },
    })
    await addVdc({ id: 'vdc-2', sdnZoneName: ownZone })
    await addVnet({
      id: 'v1', vdcId: 'vdc-2', pveName: 'vxxxxxxx', type: 'vxlan', tag: 10000, zoneName: ownZone,
    })
    await addVnet({
      id: 'v2', vdcId: 'vdc-2', pveName: 'vyyyyyyy', type: 'vlan', tag: 150,
      bridge: 'vmbr0', zoneName: sharedZone,
    })

    await deleteVdc('vdc-2')

    expect(deleteCalls((p) => p === '/cluster/sdn/vnets/vxxxxxxx')).toHaveLength(1)
    expect(deleteCalls((p) => p === '/cluster/sdn/vnets/vyyyyyyy')).toHaveLength(1)
    // The vDC's own VXLAN zone is deleted...
    expect(deleteCalls((p) => p === `/cluster/sdn/zones/${ownZone}`)).toHaveLength(1)
    // ...but the shared VLAN zone is never touched.
    expect(deleteCalls((p) => p === `/cluster/sdn/zones/${sharedZone}`)).toHaveLength(0)
    expect(putCalls((p) => p === '/cluster/sdn')).toHaveLength(1)
  })

  it('does not call applySdn when the vDC has neither a zone nor any vnet', async () => {
    await addVdc({ id: 'vdc-3', sdnZoneName: null })

    await deleteVdc('vdc-3')

    expect(deleteCalls((p) => p.startsWith('/cluster/sdn/vnets/'))).toHaveLength(0)
    expect(deleteCalls((p) => p.startsWith('/cluster/sdn/zones/'))).toHaveLength(0)
    expect(putCalls((p) => p === '/cluster/sdn')).toHaveLength(0)
  })
})
