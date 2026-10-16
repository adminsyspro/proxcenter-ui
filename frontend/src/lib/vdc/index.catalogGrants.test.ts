/**
 * Postgres-backed tests for the catalogue grants of a vDC (#903): createVdc and
 * updateVdc store the images and blueprints granted to the vDC, and
 * getVdcById reads them back. Same fixtures as index.storagePolicies.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const { pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getConnectionByIdMock: vi.fn(async () => ({ id: 'conn1' })),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))

import { createVdc, updateVdc, getVdcById } from './index'
import type { CreateVdcInput } from './types'

const TABLES = [
  'catalog_grants', 'blueprints', 'custom_images',
  'vdc_storage_policies', 'storage_policies', 'vdc_usage_cache', 'vdc_shared_bridges',
  'vdc_vlan_pools', 'vdc_nodes', 'vdc_vnets', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

beforeEach(async () => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockClear()
  await truncate(TABLES)

  // Every PVE call (pool create, zone create, applySdn) succeeds. Most GET
  // endpoints touched by the create path expect an array response
  // (/cluster/status peers lookup inside createZone, /content listings);
  // only the pool-members lookup returns an object shape.
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init: any = {}) => {
    const method = String(init?.method || 'GET').toUpperCase()
    if (method === 'GET' && path.startsWith('/pools/')) return { members: [] }
    // The VXLAN zone needs at least one peer since #899 (createZone refuses an empty list).
    if (method === 'GET' && path === '/cluster/status') return [{ type: 'node', name: 'pve1', ip: '10.0.0.1' }]
    if (method === 'GET') return []
    return {}
  })

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.createMany({
      data: [
        { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
        { id: 'conn-2', tenantId: 'default', name: 'pve-2', baseUrl: 'https://pve2', apiTokenEnc: 'enc' },
      ],
    })
    await tx.providerConnection.createMany({
      data: [{ connectionId: 'conn1' }, { connectionId: 'conn-2' }],
    })
  })
})

const baseInput: CreateVdcInput = {
  tenantId: 'tenant-1',
  connectionId: 'conn1',
  name: 'ACME',
  slug: 'acme',
  nodes: ['node1'],
  primaryStorage: 'ceph-hdd',
}

async function providerEntries(): Promise<{ imageId: string; blueprintId: string }> {
  const image = await prismaTest.customImage.create({ data: { tenantId: 'default', slug: 'golden', name: 'Golden' } })
  const blueprint = await prismaTest.blueprint.create({
    data: { tenantId: 'default', name: 'web', imageSlug: 'custom-golden', hardware: { cores: 1 } },
  })
  return { imageId: image.id, blueprintId: blueprint.id }
}

describe('vDC catalogue grants (#903)', () => {
  it('createVdc stores the granted entries and getVdcById reads them back', async () => {
    const { imageId, blueprintId } = await providerEntries()
    const vdc = await createVdc({ ...baseInput, catalogGrants: { imageIds: [imageId], blueprintIds: [blueprintId] } }, null)
    const read = await getVdcById(vdc.id)
    expect(read?.catalogGrants).toEqual({ imageIds: [imageId], blueprintIds: [blueprintId] })
  })

  it('a vDC created without grants reads back empty lists', async () => {
    const vdc = await createVdc(baseInput, null)
    expect((await getVdcById(vdc.id))?.catalogGrants).toEqual({ imageIds: [], blueprintIds: [] })
  })

  it('updateVdc replaces the grants, and leaves them alone when absent from the update', async () => {
    const { imageId, blueprintId } = await providerEntries()
    const vdc = await createVdc({ ...baseInput, catalogGrants: { imageIds: [imageId], blueprintIds: [] } }, null)
    await updateVdc(vdc.id, { catalogGrants: { imageIds: [], blueprintIds: [blueprintId] } })
    expect((await getVdcById(vdc.id))?.catalogGrants).toEqual({ imageIds: [], blueprintIds: [blueprintId] })
    await updateVdc(vdc.id, { name: 'ACME Renamed' })
    expect((await getVdcById(vdc.id))?.catalogGrants).toEqual({ imageIds: [], blueprintIds: [blueprintId] })
  })

  it("refuses to grant a tenant's own image to a vDC", async () => {
    const own = await prismaTest.customImage.create({ data: { tenantId: 'tenant-1', slug: 'mine', name: 'Mine' } })
    const vdc = await createVdc(baseInput, null)
    await expect(updateVdc(vdc.id, { catalogGrants: { imageIds: [own.id], blueprintIds: [] } })).rejects.toThrow(/provider images/)
  })
})
