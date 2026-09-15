/**
 * MOCK-based tests for the stretched tenant network module (#901): the
 * tenant-wide VNI allocation, the preferred PVE VNet id and the CRUD guards.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/tenantNetworks.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, getConnectionByIdMock, listVnetsPveMock } = vi.hoisted(() => ({
  prismaMock: {
    tenant: { findUnique: vi.fn() },
    tenantNetwork: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vdc: { findMany: vi.fn() },
    vdcVnet: { findMany: vi.fn(), findFirst: vi.fn() },
    connection: { findMany: vi.fn(), findUnique: vi.fn() },
  } as any,
  getConnectionByIdMock: vi.fn(),
  listVnetsPveMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))
vi.mock('./sdn', () => ({ listVnetsPve: listVnetsPveMock, VNI_BASE: 10000 }))

import { mapTenantNetworkError } from './httpErrors'
import {
  allocateTenantVni,
  createTenantNetwork,
  deleteTenantNetwork,
  generateTenantNetworkPveName,
  updateTenantNetwork,
} from './tenantNetworks'

// The row getTenantNetwork reads back; `create` refreshes it.
let saved: any

beforeEach(() => {
  for (const model of Object.values(prismaMock) as any[]) for (const fn of Object.values(model) as any[]) fn.mockReset()
  getConnectionByIdMock.mockReset()
  listVnetsPveMock.mockReset()

  saved = { id: 'n1', tenantId: 't1', name: 'backbone', description: null, pveName: 'v0000000', vni: 10000, mtu: null,
    createdBy: null, createdAt: new Date('2026-09-15T10:00:00Z'), updatedAt: new Date('2026-09-15T10:00:00Z'),
    tenant: { name: 'Acme' }, members: [] }

  prismaMock.tenant.findUnique.mockResolvedValue({ id: 't1' })
  prismaMock.tenantNetwork.findMany.mockResolvedValue([])
  prismaMock.tenantNetwork.findFirst.mockResolvedValue(null)
  prismaMock.tenantNetwork.findUnique.mockImplementation(async () => saved)
  prismaMock.tenantNetwork.create.mockImplementation(async ({ data }: any) => { saved = { ...saved, ...data }; return data })
  prismaMock.tenantNetwork.update.mockImplementation(async ({ data }: any) => { saved = { ...saved, ...data }; return saved })
  prismaMock.tenantNetwork.delete.mockResolvedValue({})
  prismaMock.vdc.findMany.mockResolvedValue([])
  prismaMock.vdcVnet.findMany.mockResolvedValue([])
  prismaMock.vdcVnet.findFirst.mockResolvedValue(null)
  prismaMock.connection.findMany.mockResolvedValue([])
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue({ id: 'conn' })
  listVnetsPveMock.mockResolvedValue([])
})

// A membership row as NETWORK_INCLUDE returns it.
const member = (id: string, vdcId: string) => ({
  id, vdcId, vdc: { name: `vDC ${vdcId}`, connectionId: 'c1' }, vnet: { pveName: 'v1234567', zoneName: 'zacme' },
})

const clusters = (...ids: string[]) => {
  prismaMock.vdc.findMany.mockResolvedValue(ids.map(connectionId => ({ connectionId })))
  prismaMock.connection.findMany.mockResolvedValue(ids.map(id => ({ id, name: `cluster-${id}` })))
}

describe('allocateTenantVni', () => {
  it('starts at the VNI floor when nothing is taken, and reads no VNet without a cluster', async () => {
    await expect(allocateTenantVni('t1', null)).resolves.toBe(10000)
    expect(prismaMock.vdcVnet.findMany).not.toHaveBeenCalled()
    expect(listVnetsPveMock).not.toHaveBeenCalled()
  })

  it('takes the next number above every holder: other networks, vDC VNets, live Proxmox tags', async () => {
    clusters('c1')
    prismaMock.tenantNetwork.findMany.mockResolvedValue([{ vni: 10003, name: 'other' }])
    prismaMock.vdcVnet.findMany.mockResolvedValue([{ tag: 10010, displayName: 'lan', pveName: 'vabc', vdc: { name: 'Acme prod' } }])
    listVnetsPveMock.mockResolvedValue([{ vnet: 'vlegacy', zone: 'z', tag: 10020, firewall: 0 }])
    await expect(allocateTenantVni('t1', null)).resolves.toBe(10021)
  })

  it("scans only the clusters of the tenant's vDCs", async () => {
    clusters('c1', 'c2')
    await allocateTenantVni('t1', null)
    expect(prismaMock.vdcVnet.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: 'vxlan', vdc: { connectionId: { in: ['c1', 'c2'] } } },
    }))
    expect(listVnetsPveMock).toHaveBeenCalledTimes(2)
  })

  it('never drops into the VLAN tag range because of a VLAN-only cluster', async () => {
    clusters('c1')
    listVnetsPveMock.mockResolvedValue([{ vnet: 'a', zone: 'z', tag: 100, firewall: 0 }, { vnet: 'b', zone: 'z', tag: 4094, firewall: 0 }])
    await expect(allocateTenantVni('t1', null)).resolves.toBe(10000)
  })

  it('keeps allocating from the database when a cluster is unreachable', async () => {
    clusters('c1')
    prismaMock.vdcVnet.findMany.mockResolvedValue([{ tag: 10010, displayName: 'lan', pveName: 'vabc', vdc: { name: 'Acme prod' } }])
    listVnetsPveMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(allocateTenantVni('t1', null)).resolves.toBe(10011)
  })

  it('accepts a requested VNI that is free, refuses a held one and names its holder', async () => {
    clusters('c1')
    prismaMock.tenantNetwork.findMany.mockResolvedValue([{ vni: 20000, name: 'other' }])
    prismaMock.vdcVnet.findMany.mockResolvedValue([{ tag: 10010, displayName: 'lan', pveName: 'vabc', vdc: { name: 'Acme prod' } }])
    listVnetsPveMock.mockResolvedValue([{ vnet: 'vlegacy', zone: 'z', tag: 30000, firewall: 0 }])

    await expect(allocateTenantVni('t1', 40000)).resolves.toBe(40000)
    await expect(allocateTenantVni('t1', 10010)).rejects.toThrow('VNI 10010 is already used by network "lan" of vDC "Acme prod"')
    await expect(allocateTenantVni('t1', 20000)).rejects.toThrow('already used by tenant network "other"')
    await expect(allocateTenantVni('t1', 30000)).rejects.toThrow('already used by a VNet of cluster "cluster-c1"')
  })
})

describe('generateTenantNetworkPveName', () => {
  it('is a letter plus 7 hex chars, stable for the same network id', async () => {
    const a = await generateTenantNetworkPveName('net-1', [])
    const b = await generateTenantNetworkPveName('net-1', [])
    expect(a).toMatch(/^v[0-9a-f]{7}$/)
    expect(a).toBe(b)
  })

  it("moves to a nonce variant when a VNet on the tenant's clusters or another network holds it", async () => {
    const free = await generateTenantNetworkPveName('net-1', [])
    prismaMock.vdcVnet.findFirst.mockResolvedValueOnce({ id: 'legacy' }).mockResolvedValue(null)
    const shifted = await generateTenantNetworkPveName('net-1', ['c1'])
    expect(shifted).toMatch(/^v[0-9a-f]{7}$/)
    expect(shifted).not.toBe(free)
    expect(prismaMock.vdcVnet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { pveName: free, vdc: { connectionId: { in: ['c1'] } } },
    }))
  })
})

describe('createTenantNetwork', () => {
  const input = { tenantId: 't1', name: 'backbone', mtu: 1400 }

  it('refuses the provider tenant, an unknown tenant, a bad name, a bad MTU and a bad VNI', async () => {
    await expect(createTenantNetwork({ ...input, tenantId: 'default' }, null)).rejects.toThrow('cannot be created on the provider tenant')
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null)
    await expect(createTenantNetwork(input, null)).rejects.toThrow('Tenant not found: t1')
    await expect(createTenantNetwork({ ...input, name: 'Back Bone' }, null)).rejects.toThrow('invalid name')
    await expect(createTenantNetwork({ ...input, mtu: 900 }, null)).rejects.toThrow('MTU must be an integer between 1280 and 9000')
    await expect(createTenantNetwork({ ...input, vni: 0 }, null)).rejects.toThrow('VNI must be an integer between 1 and 16777215')
    expect(prismaMock.tenantNetwork.create).not.toHaveBeenCalled()
  })

  it('refuses a name the tenant already uses', async () => {
    prismaMock.tenantNetwork.findFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(createTenantNetwork(input, null)).rejects.toThrow('"backbone" already exists for this tenant')
  })

  it('writes the row with the allocated VNI, the MTU and a PVE id, then reads it back', async () => {
    prismaMock.tenantNetwork.findMany.mockResolvedValue([{ vni: 10004, name: 'other' }])
    const created = await createTenantNetwork({ ...input, description: '  spine  ' }, 'u1')
    expect(prismaMock.tenantNetwork.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.tenantNetwork.create.mock.calls[0][0].data
    expect(data).toMatchObject({ tenantId: 't1', name: 'backbone', description: 'spine', vni: 10005, mtu: 1400, createdBy: 'u1' })
    expect(data.pveName).toMatch(/^v[0-9a-f]{7}$/)
    expect(created).toMatchObject({ id: data.id, tenantName: 'Acme', vni: 10005, mtu: 1400, members: [] })
  })

  it('honours a requested VNI', async () => {
    await createTenantNetwork({ ...input, vni: 4242 }, null)
    expect(prismaMock.tenantNetwork.create.mock.calls[0][0].data.vni).toBe(4242)
  })
})

describe('updateTenantNetwork', () => {
  it('renames and sets the MTU of a network no vDC carries yet', async () => {
    const out = await updateTenantNetwork('n1', { name: 'core', mtu: 8950 })
    expect(prismaMock.tenantNetwork.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'n1' }, data: expect.objectContaining({ name: 'core', mtu: 8950 }),
    }))
    expect(out).toMatchObject({ name: 'core', mtu: 8950 })
  })

  it('refuses an MTU change while vDCs carry the network, but still allows a rename', async () => {
    saved.members = [member('m1', 'v1'), member('m2', 'v2')]
    await expect(updateTenantNetwork('n1', { mtu: 1400 })).rejects.toThrow('the MTU cannot change while 2 vDC(s) carry the network')
    await expect(updateTenantNetwork('n1', { name: 'core', mtu: null })).resolves.toMatchObject({ name: 'core' })
  })

  it('refuses an unknown network', async () => {
    prismaMock.tenantNetwork.findUnique.mockResolvedValue(null)
    await expect(updateTenantNetwork('nope', { name: 'x' })).rejects.toThrow('Tenant network: not found: nope')
  })
})

describe('deleteTenantNetwork', () => {
  it('refuses while vDCs carry the network', async () => {
    saved.members = [member('m1', 'v1')]
    await expect(deleteTenantNetwork('n1')).rejects.toThrow('"backbone" is still carried by 1 vDC(s)')
    expect(prismaMock.tenantNetwork.delete).not.toHaveBeenCalled()
  })

  it('deletes an empty network, which releases its VNI', async () => {
    await deleteTenantNetwork('n1')
    expect(prismaMock.tenantNetwork.delete).toHaveBeenCalledWith({ where: { id: 'n1' } })
  })
})

describe('mapTenantNetworkError', () => {
  it('maps the module messages to 404, 409, 400 and the lost race to 409', () => {
    expect(mapTenantNetworkError(new Error('Tenant network: not found: x')).status).toBe(404)
    expect(mapTenantNetworkError(new Error('Tenant network: "a" already exists for this tenant.')).status).toBe(409)
    expect(mapTenantNetworkError(new Error('Tenant network: VNI 1 is already used by tenant network "b".')).status).toBe(409)
    expect(mapTenantNetworkError(new Error('Tenant network: "a" is still carried by 1 vDC(s).')).status).toBe(409)
    expect(mapTenantNetworkError(new Error('Tenant network: the MTU cannot change while 1 vDC(s) carry the network.')).status).toBe(409)
    expect(mapTenantNetworkError(new Error('Tenant network: MTU must be an integer between 1280 and 9000.')).status).toBe(400)
    expect(mapTenantNetworkError(new Error('Tenant not found: t')).status).toBe(400)
    expect(mapTenantNetworkError({ code: 'P2002', message: 'unique' })).toEqual({ status: 409, message: 'A tenant network with this name or VNI already exists.' })
    expect(mapTenantNetworkError(new Error('boom')).status).toBe(500)
  })
})
