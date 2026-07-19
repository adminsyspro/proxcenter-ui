import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: vi.fn<(...args: any[]) => Response | null>(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    STORAGE_VIEW: 'storage.view',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET } from './route'
import { demoResponse } from '@/lib/demo/demo-api'
import { getSessionPrisma } from '@/lib/tenant'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const demoResponseMock = demoResponse as any
const getSessionPrismaMock = getSessionPrisma as any
const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const TiB = 1024 ** 4

// Two PVE clusters, each with a storage named "local-lvm" but different sizes.
// PVE-1 also exposes a shared NFS storage on two nodes (within-cluster merge case).
const RESOURCES: Record<string, any[]> = {
  'conn-1': [
    { type: 'storage', storage: 'local-lvm', node: 'pve1-n1', status: 'available', disk: 45 * TiB, maxdisk: 90 * TiB },
    { type: 'storage', storage: 'nfs-shared', node: 'pve1-n1', status: 'available', disk: 5 * TiB, maxdisk: 20 * TiB },
    { type: 'storage', storage: 'nfs-shared', node: 'pve1-n2', status: 'available', disk: 5 * TiB, maxdisk: 20 * TiB },
  ],
  'conn-2': [
    { type: 'storage', storage: 'local-lvm', node: 'pve2-n1', status: 'available', disk: 3 * TiB, maxdisk: 15 * TiB },
  ],
}

const CONFIGS: Record<string, any[]> = {
  'conn-1': [
    { storage: 'local-lvm', type: 'lvmthin', content: 'images,rootdir', disable: 0 },
    { storage: 'nfs-shared', type: 'nfs', shared: 1, content: 'images,iso', server: '10.0.0.1', export: '/data' },
  ],
  'conn-2': [
    { storage: 'local-lvm', type: 'lvmthin', content: 'images,rootdir', disable: 0 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  demoResponseMock.mockReturnValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockImplementation((id: string) => Promise.resolve({ id }))
  getSessionPrismaMock.mockResolvedValue({
    connection: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'conn-1', name: 'PVE-1' },
        { id: 'conn-2', name: 'PVE-2' },
      ]),
    },
  })
  pveFetchMock.mockImplementation((connData: any, path: string) => {
    if (path === '/cluster/resources') return Promise.resolve(RESOURCES[connData.id] || [])
    if (path === '/storage') return Promise.resolve(CONFIGS[connData.id] || [])
    return Promise.resolve([])
  })
})

describe('GET /api/v1/storage', () => {
  it('keeps same-named storages on different clusters as separate rows (issue #569)', async () => {
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)

    const localLvm = body.data.filter((s: any) => s.storage === 'local-lvm')

    // Two clusters -> two distinct rows, NOT one merged row
    expect(localLvm).toHaveLength(2)

    const pve1 = localLvm.find((s: any) => s.connId === 'conn-1')
    const pve2 = localLvm.find((s: any) => s.connId === 'conn-2')

    expect(pve1).toBeDefined()
    expect(pve2).toBeDefined()

    // Each row carries its own cluster's capacity (no cross-cluster max)
    expect(pve1.total).toBe(90 * TiB)
    expect(pve1.used).toBe(45 * TiB)
    expect(pve1.usedPct).toBe(50)
    expect(pve1.connections).toEqual([{ id: 'conn-1', name: 'PVE-1' }])

    expect(pve2.total).toBe(15 * TiB)
    expect(pve2.used).toBe(3 * TiB)
    expect(pve2.usedPct).toBe(20)
    expect(pve2.connections).toEqual([{ id: 'conn-2', name: 'PVE-2' }])
  })

  it('uses connId:storage as the row id so rows are unique per cluster', async () => {
    const res = await callRoute(GET as any, { method: 'GET' })
    const body = await readJson<any>(res)

    const ids = body.data.filter((s: any) => s.storage === 'local-lvm').map((s: any) => s.id).sort()

    expect(ids).toEqual(['conn-1:local-lvm', 'conn-2:local-lvm'])
  })

  it('still merges a shared storage seen from multiple nodes of the same cluster', async () => {
    const res = await callRoute(GET as any, { method: 'GET' })
    const body = await readJson<any>(res)

    const nfs = body.data.filter((s: any) => s.storage === 'nfs-shared')

    expect(nfs).toHaveLength(1)
    expect(nfs[0].shared).toBe(true)
    expect(nfs[0].allNodes.sort()).toEqual(['pve1-n1', 'pve1-n2'])
    expect(nfs[0].total).toBe(20 * TiB)
    expect(nfs[0].nodeBreakdown).toHaveLength(1)
  })

  it('sums a local storage across nodes and exposes nodeBreakdown', async () => {
    // Override conn-1 to expose local-lvm on two nodes
    pveFetchMock.mockImplementation((connData: any, path: string) => {
      if (connData.id === 'conn-1' && path === '/cluster/resources') {
        return Promise.resolve([
          { type: 'storage', storage: 'local-lvm', node: 'pve1-n1', status: 'available', disk: 45 * TiB, maxdisk: 90 * TiB },
          { type: 'storage', storage: 'local-lvm', node: 'pve1-n2', status: 'available', disk: 15 * TiB, maxdisk: 30 * TiB },
        ])
      }
      if (connData.id === 'conn-1' && path === '/storage') {
        return Promise.resolve([{ storage: 'local-lvm', type: 'lvmthin', content: 'images', disable: 0 }])
      }
      return Promise.resolve([])
    })

    const res = await callRoute(GET as any, { method: 'GET' })
    const body = await readJson<any>(res)
    const row = body.data.find((s: any) => s.id === 'conn-1:local-lvm')

    expect(row.total).toBe(120 * TiB)
    expect(row.used).toBe(60 * TiB)
    expect(row.allNodes.sort()).toEqual(['pve1-n1', 'pve1-n2'])
    expect(row.nodeBreakdown).toHaveLength(2)
    expect(row.connectionName).toBe('PVE-1')
    expect(row.connections).toEqual([{ id: 'conn-1', name: 'PVE-1' }])
  })

  it('returns the demo payload when demoResponse short-circuits', async () => {
    const demo = new Response(JSON.stringify({ data: ['demo'] }), { status: 200 })
    demoResponseMock.mockReturnValue(demo)

    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res).toBe(demo)
    expect(getSessionPrismaMock).not.toHaveBeenCalled()
  })

  it('propagates the RBAC denial without querying PVE', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty list when no PVE connections exist', async () => {
    getSessionPrismaMock.mockResolvedValue({
      connection: { findMany: vi.fn().mockResolvedValue([]) },
    })

    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual([])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
