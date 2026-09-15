/**
 * Postgres-backed tests for the ISO library grants (#894) in `getVdcScope`:
 * a granted storage is VISIBLE (`storagesByConnection`, so the CD/DVD
 * pickers and the content route accept it) but never WRITABLE
 * (`writableStoragesByConnection`), and it is listed in
 * `isoLibrariesByConnection` so the drive guard can refuse data disks on it.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'
import { clearVdcScopeCache, getVdcScope } from './scope'

const TABLES = [
  'vdc_iso_libraries', 'vdc_storage_policies', 'storage_policies', 'vdc_nodes', 'vdcs',
  'provider_connections', 'Connection', 'tenants',
]

afterEach(async () => {
  clearVdcScopeCache()
  await truncate(TABLES)
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

async function addTenant(id: string): Promise<void> {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id, slug: id, name: id, operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
}

async function addConnection(id: string): Promise<void> {
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: { id, tenantId: 'default', name: id, baseUrl: `https://${id}`, apiTokenEnc: 'enc' },
    })
    await tx.providerConnection.create({ data: { connectionId: id } })
  })
}

async function addVdc(opts: { id: string; connectionId: string; tenantId: string; primaryStorage: string }): Promise<void> {
  await prismaTest.vdc.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId,
      connectionId: opts.connectionId,
      name: opts.id,
      slug: opts.id,
      pvePoolName: `pool-${opts.id}`,
      primaryStorage: opts.primaryStorage,
    },
  })
}

async function grantLibrary(vdcId: string, storageId: string, allowUploads = false): Promise<void> {
  await prismaTest.vdcIsoLibrary.create({ data: { id: `${vdcId}-${storageId}`, vdcId, storageId, allowUploads } })
}

describe('getVdcScope: ISO libraries (#894)', () => {
  it('a granted library is visible but not writable, and listed as a library', async () => {
    const tenantId = 'tenant-scope-iso-1'
    await addTenant(tenantId)
    await addConnection('conn-iso-1')
    await addVdc({ id: 'vdc-iso-1', connectionId: 'conn-iso-1', tenantId, primaryStorage: 'ceph-hdd' })
    await grantLibrary('vdc-iso-1', 'isolib')

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    expect(scope!.storagesByConnection.get('conn-iso-1')!.has('isolib')).toBe(true)
    expect(scope!.writableStoragesByConnection.get('conn-iso-1')!.has('isolib')).toBe(false)
    expect(scope!.isoLibrariesByConnection.get('conn-iso-1')!.has('isolib')).toBe(true)
  })

  it('the primary storage stays both visible and writable, and is not a library', async () => {
    const tenantId = 'tenant-scope-iso-2'
    await addTenant(tenantId)
    await addConnection('conn-iso-2')
    await addVdc({ id: 'vdc-iso-2', connectionId: 'conn-iso-2', tenantId, primaryStorage: 'ceph-hdd' })
    await grantLibrary('vdc-iso-2', 'isolib')

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    expect(scope!.storagesByConnection.get('conn-iso-2')!.has('ceph-hdd')).toBe(true)
    expect(scope!.writableStoragesByConnection.get('conn-iso-2')!.has('ceph-hdd')).toBe(true)
    expect(scope!.isoLibrariesByConnection.get('conn-iso-2')!.has('ceph-hdd')).toBe(false)
  })

  it('a vDC without a library grant has an empty library set and identical visible/writable sets', async () => {
    const tenantId = 'tenant-scope-iso-3'
    await addTenant(tenantId)
    await addConnection('conn-iso-3')
    await addVdc({ id: 'vdc-iso-3', connectionId: 'conn-iso-3', tenantId, primaryStorage: 'ceph-hdd' })

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    expect(scope!.isoLibrariesByConnection.get('conn-iso-3')!.size).toBe(0)
    expect(Array.from(scope!.storagesByConnection.get('conn-iso-3')!)).toEqual(['ceph-hdd'])
    expect(Array.from(scope!.writableStoragesByConnection.get('conn-iso-3')!)).toEqual(['ceph-hdd'])
  })

  it('a tenant without any vDC gets empty maps for the new fields too (deny by construction)', async () => {
    const scope = await getVdcScope('tenant-scope-iso-none')
    expect(scope).not.toBeNull()
    expect(scope!.writableStoragesByConnection.size).toBe(0)
    expect(scope!.isoLibrariesByConnection.size).toBe(0)
    expect(scope!.uploadLibrariesByConnection.size).toBe(0)
  })

  it('a library with allowUploads is listed as an upload library but is still not writable', async () => {
    const tenantId = 'tenant-scope-iso-4'
    await addTenant(tenantId)
    await addConnection('conn-iso-4')
    await addVdc({ id: 'vdc-iso-4', connectionId: 'conn-iso-4', tenantId, primaryStorage: 'ceph-hdd' })
    await grantLibrary('vdc-iso-4', 'isolib-rw', true)
    await grantLibrary('vdc-iso-4', 'isolib-ro', false)

    const scope = await getVdcScope(tenantId)
    expect(scope).not.toBeNull()

    const libs = scope!.isoLibrariesByConnection.get('conn-iso-4')!
    const uploads = scope!.uploadLibrariesByConnection.get('conn-iso-4')!
    const writable = scope!.writableStoragesByConnection.get('conn-iso-4')!
    expect(libs.has('isolib-rw') && libs.has('isolib-ro')).toBe(true)
    expect(uploads.has('isolib-rw')).toBe(true)
    expect(uploads.has('isolib-ro')).toBe(false)
    expect(writable.has('isolib-rw')).toBe(false)
    expect(scope!.storagesByConnection.get('conn-iso-4')!.has('isolib-rw')).toBe(true)
  })
})
