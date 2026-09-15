/**
 * Task 14: storage-policy metadata decoration on the tenant storage picker
 * route (spec §8.3). An iaas tenant's storages response gets a `policy`
 * key (name + QoS caps) on entries whose storage carries an assigned
 * storage policy, so the picker can show the tier without a second call.
 * provider/msp get `maskingScope(...) === null`: the response is
 * unchanged, no `policy` key on any entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  buildNodeResourceId: (id: string, node: string) => `${id}:${node}`,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: vi.fn<(tenantId: string) => Promise<any>>(),
  maskingScope: vi.fn<(infra: any) => any>(),
}))

import { GET } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const getCurrentTenantIdMock = getCurrentTenantId as any
const getTenantInfrastructureScopeMock = getTenantInfrastructureScope as any
const maskingScopeMock = maskingScope as any

const NODE_STORAGES = [
  { storage: 'ceph-gold', type: 'rbd', content: 'images,rootdir' },
  { storage: 'ceph-silver', type: 'rbd', content: 'images,rootdir' },
]

const GOLD_POLICY = { policyId: 'p1', name: 'Gold', iopsRd: 5000, iopsWr: 3000, mbpsRd: 500, mbpsWr: 300 }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn1' })
  getCurrentTenantIdMock.mockResolvedValue('tenant-x')
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas' })
  maskingScopeMock.mockReturnValue(null)
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path === '/storage') return Promise.resolve([])
    return Promise.resolve(NODE_STORAGES)
  })
})

const call = () => callRoute(GET, { params: { id: 'conn1', node: 'pve1' } })

describe('GET storages: storage-policy metadata decoration (Task 14)', () => {
  it('iaas: decorates only the storage carrying an assigned policy', async () => {
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['conn1', new Set(['ceph-gold', 'ceph-silver'])]]),
      storagePoliciesByConnection: new Map([['conn1', new Map([['ceph-gold', GOLD_POLICY]])]]),
    })

    const body = await readJson<any>(await call())

    const gold = body.data.find((s: any) => s.storage === 'ceph-gold')
    const silver = body.data.find((s: any) => s.storage === 'ceph-silver')

    expect(gold.policy).toEqual({ name: 'Gold', iopsRd: 5000, iopsWr: 3000, mbpsRd: 500, mbpsWr: 300 })
    expect(silver.policy).toBeUndefined()
  })

  it('iaas: no policy assigned on any storage leaves entries undecorated', async () => {
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['conn1', new Set(['ceph-gold', 'ceph-silver'])]]),
      storagePoliciesByConnection: new Map([['conn1', new Map()]]),
    })

    const body = await readJson<any>(await call())

    for (const s of body.data) {
      expect(s.policy).toBeUndefined()
    }
  })

  // #894: a storage the tenant reaches only through an ISO library grant is an
  // ISO source, whatever else its backend can hold. It is offered to `iso`
  // listings and hidden from every other picker (disks, backups, imports).
  it('iaas: a library-only storage with images+iso content shows up for content=iso only', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/storage') return Promise.resolve([])
      return Promise.resolve([
        ...NODE_STORAGES,
        { storage: 'nfs-lib', type: 'nfs', content: 'images,iso' },
      ])
    })
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['conn1', new Set(['ceph-gold', 'nfs-lib'])]]),
      writableStoragesByConnection: new Map([['conn1', new Set(['ceph-gold'])]]),
      isoLibrariesByConnection: new Map([['conn1', new Set(['nfs-lib'])]]),
      storagePoliciesByConnection: new Map([['conn1', new Map()]]),
    })

    const forIso = await readJson<any>(await callRoute(GET, { params: { id: 'conn1', node: 'pve1' }, searchParams: { content: 'iso' } }))
    expect(forIso.data.map((s: any) => s.storage)).toEqual(['nfs-lib'])

    const forImages = await readJson<any>(await callRoute(GET, { params: { id: 'conn1', node: 'pve1' }, searchParams: { content: 'images' } }))
    expect(forImages.data.map((s: any) => s.storage)).toEqual(['ceph-gold'])

    const unfiltered = await readJson<any>(await call())
    expect(unfiltered.data.map((s: any) => s.storage)).toEqual(['ceph-gold'])
  })

  // #894: `tenantCanUpload` tells the CD/DVD dialogs whether to offer an
  // upload button. True on an ISO library whose grant allows uploads, or on a
  // writable non-shared storage; false elsewhere; absent for provider/MSP.
  it('iaas: tenantCanUpload is true on an upload-enabled library and on a writable local storage only', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/storage') return Promise.resolve([])
      return Promise.resolve([
        { storage: 'ceph-gold', type: 'rbd', content: 'images,rootdir', shared: 1 },
        { storage: 'local-scratch', type: 'dir', content: 'images,iso', shared: 0 },
        { storage: 'lib-ro', type: 'nfs', content: 'iso', shared: 1 },
        { storage: 'lib-rw', type: 'nfs', content: 'iso', shared: 1 },
      ])
    })
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['conn1', new Set(['ceph-gold', 'local-scratch', 'lib-ro', 'lib-rw'])]]),
      writableStoragesByConnection: new Map([['conn1', new Set(['ceph-gold', 'local-scratch'])]]),
      isoLibrariesByConnection: new Map([['conn1', new Set(['lib-ro', 'lib-rw'])]]),
      uploadLibrariesByConnection: new Map([['conn1', new Set(['lib-rw'])]]),
      storagePoliciesByConnection: new Map([['conn1', new Map()]]),
    })

    const body = await readJson<any>(await callRoute(GET, { params: { id: 'conn1', node: 'pve1' }, searchParams: { content: 'iso' } }))
    const flags = Object.fromEntries(body.data.map((s: any) => [s.storage, s.tenantCanUpload]))

    expect(flags).toEqual({ 'local-scratch': true, 'lib-ro': false, 'lib-rw': true })
  })

  it('iaas: a shared writable storage is not an upload target', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/storage') return Promise.resolve([])
      return Promise.resolve([{ storage: 'nfs-iso', type: 'nfs', content: 'images,iso', shared: 1 }])
    })
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['conn1', new Set(['nfs-iso'])]]),
      writableStoragesByConnection: new Map([['conn1', new Set(['nfs-iso'])]]),
      isoLibrariesByConnection: new Map([['conn1', new Set()]]),
      uploadLibrariesByConnection: new Map([['conn1', new Set()]]),
      storagePoliciesByConnection: new Map([['conn1', new Map()]]),
    })

    const body = await readJson<any>(await call())
    expect(body.data[0].tenantCanUpload).toBe(false)
  })

  it('provider: maskingScope is null, no policy decoration and every row is uploadable (the write guard does not restrict the provider)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    maskingScopeMock.mockReturnValue(null)

    const body = await readJson<any>(await call())

    expect(body.data).toHaveLength(2)
    for (const s of body.data) {
      expect(s).not.toHaveProperty('policy')
      expect(s.tenantCanUpload).toBe(true)
    }
  })
})
