import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  buildNodeResourceId: (id: string, node: string) => `${id}:${node}`,
  getRequestGuestScopePerimeter: vi.fn(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', VM_VIEW: 'vm.view' },
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
import { checkPermission, getRequestGuestScopePerimeter } from '@/lib/rbac'
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
  checkPermissionMock.mockReset().mockResolvedValue(null)
  vi.mocked(getRequestGuestScopePerimeter).mockReset().mockResolvedValue(null)
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


describe('GET storages: ISO picker permission and perimeter', () => {
  const forbidden = () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  const request = (content = 'iso', node = 'pve1', id = 'c1') => callRoute(GET, {
    params: { id, node }, searchParams: content ? { content } : {},
  })
  const tenantScope = () => ({
    storagesByConnection: new Map([['c1', new Set(['nas'])]]),
    nodesByConnection: new Map([['c1', new Set(['pve1'])]]),
    isoLibrariesByConnection: new Map([['c1', new Set(['nas'])]]),
    writableStoragesByConnection: new Map([['c1', new Set<string>()]]),
  })
  const flatGrant = (nodes = ['pve1']) => {
    checkPermissionMock.mockImplementation(() => Promise.resolve(forbidden()))
    vi.mocked(getRequestGuestScopePerimeter).mockResolvedValue({
      restricted: true, holdsPermission: true, hasVisibleGuests: true,
      pools: new Set(), nodes: new Set(nodes),
    })
  }

  beforeEach(() => {
    stubPve([])
    maskingScopeMock.mockReturnValue(tenantScope())
    checkPermissionMock.mockImplementation((permission: string) => Promise.resolve(
      permission === 'vm.view' ? null : forbidden(),
    ))
  })

  it('lets a tenant VM viewer list only its ISO library without making it uploadable', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    const body = await readJson<any>(response)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ storage: 'nas', tenantCanUpload: false })
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.view', 'node', 'c1:pve1')
  })

  it.each(['images', 'iso,images', 'images,iso', '', ' iso'])('keeps connection.view mandatory for %j', async content => {
    expect((await request(content)).status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getRequestGuestScopePerimeter).not.toHaveBeenCalled()
  })

  it.each([['pve2', 'c1'], ['pve1', 'other-connection']])('rejects tenant node %s on %s before lookup', async (node, id) => {
    expect((await request('iso', node, id)).status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('rejects an ISO request when the tenant has no assigned storage before lookup', async () => {
    maskingScopeMock.mockReturnValue({ ...tenantScope(), storagesByConnection: new Map() })
    expect((await request()).status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('allows a flat VM grant on the node hosting a visible guest', async () => {
    flatGrant()
    expect((await request()).status).toBe(200)
    expect(getRequestGuestScopePerimeter).toHaveBeenCalledWith('c1', 'vm.view')
  })

  it('does not let a flat VM grant browse another node in the same connection', async () => {
    flatGrant(['pve2'])
    expect((await request()).status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { restricted: true, holdsPermission: false, hasVisibleGuests: true, nodes: new Set(['pve1']), pools: new Set() },
    { restricted: true, holdsPermission: true, hasVisibleGuests: false, nodes: new Set(), pools: new Set() },
    { restricted: false, holdsPermission: true, hasVisibleGuests: true, nodes: new Set(['pve1']), pools: new Set() },
  ])('fails closed when the guest perimeter cannot authorize the request (%j)', async perimeter => {
    flatGrant()
    vi.mocked(getRequestGuestScopePerimeter).mockResolvedValue(perimeter)
    expect((await request()).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('preserves legacy connection.view access for provider and MSP ISO lists', async () => {
    maskingScopeMock.mockReturnValue(null)
    checkPermissionMock.mockResolvedValue(null)
    expect((await request()).status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledTimes(1)
    expect(getRequestGuestScopePerimeter).not.toHaveBeenCalled()
  })
})
