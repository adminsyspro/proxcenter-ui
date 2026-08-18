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
  { storage: 'FC-LAB01', type: 'lvm', content: 'images,rootdir' },
  { storage: 'local-lvm', type: 'lvmthin', content: 'images,rootdir' },
  { storage: 'nas', type: 'nfs', content: 'images,iso' },
]

function stubPve(clusterConfig: any) {
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path === '/storage') {
      return typeof clusterConfig === 'function' ? clusterConfig() : Promise.resolve(clusterConfig)
    }

    return Promise.resolve(NODE_STORAGES)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'c1' })
  getCurrentTenantIdMock.mockResolvedValue('t1')
  getTenantInfrastructureScopeMock.mockResolvedValue(null)
  maskingScopeMock.mockReturnValue(null)
})

const call = () => callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

/* ------------------------------------------------------------------ */
/* Format capability merged from the cluster config (issue #735)      */
/* ------------------------------------------------------------------ */

describe('GET storages: disk format capability', () => {
  it('opens qcow2 on an LVM storage that snapshots as volume chain', async () => {
    stubPve([{ storage: 'FC-LAB01', type: 'lvm', 'snapshot-as-volume-chain': 1 }])

    const body = await readJson<any>(await call())
    const fc = body.data.find((s: any) => s.storage === 'FC-LAB01')

    expect(fc.formats).toEqual(['raw', 'qcow2'])
    expect(fc.defaultFormat).toBe('qcow2')
  })

  it('keeps a plain LVM and a thin pool on raw', async () => {
    stubPve([{ storage: 'FC-LAB01', type: 'lvm' }, { storage: 'local-lvm', type: 'lvmthin' }])

    const body = await readJson<any>(await call())

    expect(body.data.find((s: any) => s.storage === 'FC-LAB01').formats).toEqual(['raw'])
    expect(body.data.find((s: any) => s.storage === 'local-lvm').formats).toEqual(['raw'])
  })

  it('gives a file-based storage its full set', async () => {
    stubPve([{ storage: 'nas', type: 'nfs' }])

    const body = await readJson<any>(await call())

    expect(body.data.find((s: any) => s.storage === 'nas').formats).toEqual(['raw', 'qcow2', 'vmdk'])
  })

  // A caller without Datastore.Audit must still get the storage list.
  it('degrades to the type-based answer when the cluster config is unreadable', async () => {
    stubPve(() => Promise.reject(new Error('403 permission denied')))

    const body = await readJson<any>(await call())

    expect(body.data).toHaveLength(3)
    expect(body.data.find((s: any) => s.storage === 'FC-LAB01').formats).toEqual(['raw'])
    expect(body.data.find((s: any) => s.storage === 'nas').formats).toEqual(['raw', 'qcow2', 'vmdk'])
  })
})
