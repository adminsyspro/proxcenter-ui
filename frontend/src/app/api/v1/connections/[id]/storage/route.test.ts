import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
  },
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

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'c1' })
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path === '/cluster/resources') {
      return Promise.resolve([
        { type: 'storage', storage: 'zpool', node: 'n1', disk: 1, maxdisk: 2, status: 'available' },
      ])
    }
    if (path === '/storage') {
      return Promise.resolve([{ storage: 'zpool', type: 'zfs', content: 'images' }]) // no shared flag
    }
    return Promise.resolve([])
  })
  getCurrentTenantIdMock.mockResolvedValue('provider-tenant')
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  maskingScopeMock.mockReturnValue(null) // provider: no tenant restriction
})

describe('GET /api/v1/connections/[id]/storage', () => {
  it('classifies a flag-less zfs storage as shared', async () => {
    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)
    const zpool = body.data.find((s: any) => s.storage === 'zpool')

    expect(zpool.shared).toBe(true)
  })

  it('hides the now-shared zfs storage from vDC-tenant-scoped views', async () => {
    // Activate tenant (vDC) scope: allowedStorages/allowedNodes would otherwise
    // let 'zpool' through, but the shared-storage filter must drop it anyway
    // since it is not a 'pbs' storage.
    getCurrentTenantIdMock.mockResolvedValue('tenant-abc')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    maskingScopeMock.mockReturnValue({
      storagesByConnection: new Map([['c1', new Set(['zpool'])]]),
      nodesByConnection: new Map([['c1', new Set(['n1'])]]),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(body.data.find((s: any) => s.storage === 'zpool')).toBeUndefined()
  })
})
