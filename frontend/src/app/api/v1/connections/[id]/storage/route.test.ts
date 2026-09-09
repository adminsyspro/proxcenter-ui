import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  getRequestGuestScopePerimeter: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
    BACKUP_VIEW: 'backup.view',
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
  getSessionPrisma: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/storage/attachPbsStorage', () => ({
  attachPbsStorage: vi.fn(),
  PbsAttachError: class PbsAttachError extends Error {
    constructor(message: string, readonly status = 400, readonly code = 'invalid_request') {
      super(message)
      this.name = 'PbsAttachError'
    }
  },
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: vi.fn<(tenantId: string) => Promise<any>>(),
  maskingScope: vi.fn<(infra: any) => any>(),
}))

import { GET, POST } from './route'
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { audit } from '@/lib/audit'
import { attachPbsStorage, PbsAttachError, type AttachPbsStorageResult } from '@/lib/storage/attachPbsStorage'

const checkPermissionMock = checkPermission as any
const getRequestGuestScopePerimeterMock = getRequestGuestScopePerimeter as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const getCurrentTenantIdMock = getCurrentTenantId as any
const getTenantInfrastructureScopeMock = getTenantInfrastructureScope as any
const maskingScopeMock = maskingScope as any

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockResolvedValue(null)
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

describe('GET /api/v1/connections/[id]/storage: flat-scoped narrowing', () => {
  // A cluster with one shared storage spread over two nodes, plus one local
  // storage per node. The flat-scoped caller only owns a guest on n1.
  const withThreeStorages = () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/cluster/resources') {
        return Promise.resolve([
          { type: 'storage', storage: 'shared-nfs', node: 'n1', disk: 1, maxdisk: 4, status: 'available' },
          { type: 'storage', storage: 'shared-nfs', node: 'n2', disk: 1, maxdisk: 4, status: 'available' },
          { type: 'storage', storage: 'local-n1', node: 'n1', disk: 1, maxdisk: 2, status: 'available' },
          { type: 'storage', storage: 'local-n2', node: 'n2', disk: 1, maxdisk: 2, status: 'available' },
        ])
      }
      if (path === '/storage') {
        return Promise.resolve([
          { storage: 'shared-nfs', type: 'nfs', content: 'images' },
          { storage: 'local-n1', type: 'dir', content: 'images' },
          { storage: 'local-n2', type: 'dir', content: 'images' },
        ])
      }
      return Promise.resolve([])
    })
  }

  const restrictedPerimeter = () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: true,
      pools: new Set(['p1']),
      nodes: new Set(['n1']),
    })
  }

  it('keeps every shared storage, usable from anywhere on the cluster', async () => {
    withThreeStorages()
    restrictedPerimeter()

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)
    const shared = body.data.find((s: any) => s.storage === 'shared-nfs')

    expect(res.status).toBe(200)
    expect(shared).toBeDefined()
    expect(shared.shared).toBe(true)
    expect(shared.nodes).toEqual(['n1', 'n2'])
  })

  it('keeps a local storage sitting on a node that hosts one of their guests', async () => {
    withThreeStorages()
    restrictedPerimeter()

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)
    const local = body.data.find((s: any) => s.storage === 'local-n1')

    expect(res.status).toBe(200)
    expect(local).toBeDefined()
    expect(local.shared).toBe(false)
    expect(local.node).toBe('n1')
  })

  it('drops a local storage on a node outside their perimeter', async () => {
    withThreeStorages()
    restrictedPerimeter()

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.find((s: any) => s.storage === 'local-n2')).toBeUndefined()
    expect(body.data.map((s: any) => s.storage).sort()).toEqual(['local-n1', 'shared-nfs'])
  })

  it('leaves the list untouched for a connection-scoped caller', async () => {
    withThreeStorages()

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.map((s: any) => s.storage).sort()).toEqual(['local-n1', 'local-n2', 'shared-nfs'])
    // No fallback needed, so the perimeter is never resolved.
    expect(getRequestGuestScopePerimeterMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/connections/[id]/storage', () => {
  const conn = {
    id: 'c1', name: 'prod', baseUrl: 'https://pve.lab:8006',
    apiToken: 'root@pam!admin:secret', insecureDev: true, behindProxy: false,
  }
  const findFirst = vi.fn()
  const registeredBody = {
    type: 'pbs', storage: 'pbs-main', datastore: 'store1', namespace: 'tenant/prod',
    nodes: ['n1'], pbsConnectionId: 'pbs1',
  }
  const attachResult: AttachPbsStorageResult = {
    storage: 'pbs-main', server: 'pbs.lab', datastore: 'store1', namespace: 'tenant/prod',
    nodes: ['n1'], credentials: 'scoped-token', tokenId: 'root@pam!pxc-x',
    steps: { namespace: 'created', token: 'created', acl: 'ok' },
  }

  beforeEach(() => {
    vi.mocked(attachPbsStorage).mockReset().mockResolvedValue(attachResult)
    vi.mocked(audit).mockReset()
    findFirst.mockReset().mockResolvedValue({ id: 'pbs1' })
    vi.mocked(getSessionPrisma).mockReset().mockResolvedValue({ connection: { findFirst } } as any)
    getConnectionByIdMock.mockResolvedValue(conn)
    pveFetchMock.mockResolvedValue([{ node: 'n1' }, { node: 'n2' }])
  })

  it('requires CONNECTION_MANAGE on the target cluster', async () => {
    checkPermissionMock.mockImplementation(async (permission: string) =>
      permission === PERMISSIONS.CONNECTION_MANAGE ? deniedPermissionResponse() : null)

    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith(PERMISSIONS.CONNECTION_MANAGE, 'connection', 'c1')
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('denies a masked vDC tenant', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-vdc')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    maskingScopeMock.mockReturnValue({ storagesByConnection: new Map() })

    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(403)
    expect(getTenantInfrastructureScope).toHaveBeenCalledWith('tenant-vdc')
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const res = await callRoute(POST, {
      method: 'POST', params: { id: 'c1' }, body: '{invalid',
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'Invalid JSON body' })
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('rejects a non-PBS storage type', async () => {
    const res = await callRoute(POST, {
      method: 'POST', params: { id: 'c1' }, body: { ...registeredBody, type: 'nfs' },
    })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: expect.stringContaining('Unsupported storage type "nfs"') })
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('returns 404 when the registered PBS is absent from the session tenant', async () => {
    findFirst.mockResolvedValue(null)

    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'PBS connection not found' })
    expect(getSessionPrisma).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'pbs1', type: 'pbs' }, select: { id: true } })
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('requires BACKUP_VIEW on the registered PBS', async () => {
    checkPermissionMock.mockImplementation(async (permission: string) =>
      permission === PERMISSIONS.BACKUP_VIEW ? deniedPermissionResponse() : null)

    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith(PERMISSIONS.BACKUP_VIEW, 'pbs', 'pbs1')
    expect(findFirst).not.toHaveBeenCalled()
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('lists every unknown node and prevents attaching unusable storage', async () => {
    const res = await callRoute(POST, {
      method: 'POST', params: { id: 'c1' },
      body: { ...registeredBody, nodes: ['n1', 'missing-a', 'missing-b'] },
    })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'Unknown node(s) on this cluster: missing-a, missing-b' })
    expect(pveFetch).toHaveBeenCalledWith(conn, '/nodes')
    expect(attachPbsStorage).not.toHaveBeenCalled()
  })

  it('attaches a registered PBS and audits success', async () => {
    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ data: attachResult })
    expect(attachPbsStorage).toHaveBeenCalledExactlyOnceWith({
      pveConn: conn, storage: 'pbs-main', datastore: 'store1', namespace: 'tenant/prod', nodes: ['n1'],
      pbsConnectionId: 'pbs1',
    })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', category: 'storage', resourceId: 'pbs-main', status: 'success',
      details: expect.objectContaining({ connectionId: 'c1', pbsConnectionId: 'pbs1', credentials: 'scoped-token' }),
    }))
  })

  it('refuses a body without pbsConnectionId before touching anything', async () => {
    // Hand-typed credentials used to be accepted here. Only a backup server
    // declared in the connections can be attached now, so the route refuses
    // the call rather than letting the lib decide.
    const res = await callRoute(POST, {
      method: 'POST',
      params: { id: 'c1' },
      body: {
        type: 'pbs', storage: 'pbs-main', datastore: 'store1',
        server: 'external.lab', username: 'backup@pbs!manual', password: 'secret',
      },
    })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toMatchObject({ code: 'pbs_connection_required' })
    expect(attachPbsStorage).not.toHaveBeenCalled()
    expect(getSessionPrisma).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each([
    [409, 'storage_exists'],
    [502, 'token_secret_missing'],
  ])('maps a PbsAttachError to status %s and code %s and audits failure', async (status, code) => {
    vi.mocked(attachPbsStorage).mockRejectedValue(new PbsAttachError('Attach failed', status, code))

    const res = await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: registeredBody })

    expect(res.status).toBe(status)
    expect(await readJson(res)).toEqual({ error: 'Attach failed', code })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failure', errorMessage: 'Attach failed', resourceId: 'pbs-main',
    }))
  })
})
