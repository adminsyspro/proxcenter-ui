import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  getRequestGuestScopePerimeter: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => {
  class PveApplicationError extends Error {
    statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  }

  return { pveFetch: vi.fn<(...args: any[]) => Promise<any>>(), PveApplicationError }
})

vi.mock('@/lib/audit', () => ({ audit: vi.fn<(...args: any[]) => Promise<string>>() }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn<() => void>() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdc: { findFirst: vi.fn<(...args: any[]) => Promise<any>>() } } }))

import { GET, POST, PUT, DELETE } from './route'
import { audit } from '@/lib/audit'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { prisma } from '@/lib/db/prisma'
import { checkPermission, getRequestGuestScopePerimeter } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch, PveApplicationError } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getRequestGuestScopePerimeterMock = getRequestGuestScopePerimeter as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'c1' })
  ;(prisma.vdc.findFirst as any).mockResolvedValue(null)
  pveFetchMock.mockResolvedValue([
    { poolid: 'p1', comment: 'first pool' },
    { poolid: 'p2', comment: null },
  ])
})

describe('GET /api/v1/connections/[id]/pools', () => {
  it('returns the full pool list to a connection-scoped caller', async () => {
    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.map((p: any) => p.poolid)).toEqual(['p1', 'p2'])
    expect(body.restricted).toBe(false)
    // No fallback needed, so the perimeter is never resolved.
    expect(getRequestGuestScopePerimeterMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/connections/[id]/pools: flat-scoped fallback', () => {
  it('lets a flat-scoped caller through and narrows the list to their pools', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: true,
      pools: new Set(['p1']),
      nodes: new Set(['n1']),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ poolid: 'p1', comment: 'first pool' }])
    expect(body.restricted).toBe(true)
  })

  it('keeps the 403 when the caller owns no visible guest on this connection', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: false,
      pools: new Set(['p1']),
      nodes: new Set<string>(),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 when the caller holds the permission nowhere', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: false,
      hasVisibleGuests: true,
      pools: new Set(['p1']),
      nodes: new Set(['n1']),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 when there is no perimeter at all (token or anonymous caller)', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue(null)

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

const pveCall = (i = 0) => {
  const [, path, init] = pveFetchMock.mock.calls[i]

  return { path, method: init?.method, body: init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : undefined }
}

describe('POST /api/v1/connections/[id]/pools', () => {
  it.each(['pc.dot-test', 'team/dev_1', 'a/b/c'])('accepts the Proxmox-valid pool id %j', async poolid => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid } })

    expect(res.status).toBe(201)
  })

  it('creates the pool on Proxmox, invalidates the inventory and audits it', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'team/dev', comment: ' Dev team ' } })

    expect(res.status).toBe(201)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'c1')
    expect(pveCall()).toEqual({ path: '/pools', method: 'POST', body: { poolid: 'team/dev', comment: 'Dev team' } })
    expect(invalidateInventoryCache).toHaveBeenCalled()
    expect((audit as any).mock.calls[0][0]).toMatchObject({ action: 'pool.create', status: 'success', resourceId: 'c1:team/dev' })
  })

  it('refuses a caller without connection.manage before touching Proxmox', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p3' } })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each(['', 'a b', 'a/b/c/d', '../x', 'x/', '1pool', 'a/..', 'a/./b'])('rejects the malformed pool id %j', async poolid => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('relays a Proxmox refusal with its status and audits the failure', async () => {
    pveFetchMock.mockRejectedValue(new (PveApplicationError as any)('PVE 400 /pools: {"message":"create pool failed: pool \'p1\' already exists\\n","data":null}', 400))

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(400)
    expect(body.error).toBe("create pool failed: pool 'p1' already exists")
    expect(invalidateInventoryCache).not.toHaveBeenCalled()
    expect((audit as any).mock.calls[0][0]).toMatchObject({ action: 'pool.create', status: 'failure' })
  })
})

describe('PUT /api/v1/connections/[id]/pools', () => {
  it('updates the comment through the PVE 8.1+ form, poolid as a parameter', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'team/dev', comment: 'new' } })

    expect(res.status).toBe(200)
    expect(pveCall()).toEqual({ path: '/pools', method: 'PUT', body: { poolid: 'team/dev', comment: 'new' } })
  })

  it('sends an emptied comment so Proxmox clears it', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'p1', comment: '  ' } })

    expect(pveCall().body).toEqual({ poolid: 'p1', comment: '' })
  })

  it('falls back to /pools/{poolid} on a PVE 8.0 that answers 501', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new (PveApplicationError as any)("PVE 501 /pools: Method 'PUT /pools' not implemented", 501))
      .mockResolvedValueOnce(null)

    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'p1', comment: 'x' } })

    expect(res.status).toBe(200)
    expect(pveCall(1)).toEqual({ path: '/pools/p1', method: 'PUT', body: { comment: 'x' } })
  })

  it('requires a comment field', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'p1' } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/connections/[id]/pools', () => {
  it('deletes the pool with poolid as a query parameter', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'c1' }, searchParams: { poolid: 'team/dev' } })

    expect(res.status).toBe(200)
    expect(pveCall()).toEqual({ path: '/pools?poolid=team%2Fdev', method: 'DELETE', body: undefined })
    expect((audit as any).mock.calls[0][0]).toMatchObject({ action: 'pool.delete', status: 'success' })
  })

  it('refuses to delete the pool a vDC is built on', async () => {
    ;(prisma.vdc.findFirst as any).mockResolvedValue({ name: 'Acme prod' })

    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'c1' }, searchParams: { poolid: 'vdc-acme-prod' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(409)
    expect(body).toMatchObject({ code: 'POOL_OWNED_BY_VDC', vdc: 'Acme prod' })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('never falls back to the legacy path for a nested id', async () => {
    pveFetchMock.mockRejectedValue(new (PveApplicationError as any)('PVE 501 /pools: not implemented', 501))

    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'c1' }, searchParams: { poolid: 'a/b' } })

    expect(res.status).toBe(500)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('pools writes: error edges', () => {
  it('keeps a non-PVE error message as is', async () => {
    pveFetchMock.mockRejectedValue(new Error('socket hang up'))

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p3' } })

    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('socket hang up')
  })

  it('keeps the envelope when the PVE body is not JSON', async () => {
    pveFetchMock.mockRejectedValue(new (PveApplicationError as any)('PVE 400 /pools: <html>bad</html>', 400))

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p3' } })

    expect((await readJson<any>(res)).error).toBe('PVE 400 /pools: <html>bad</html>')
  })

  it('appends the parameter errors Proxmox lists', async () => {
    pveFetchMock.mockRejectedValue(new (PveApplicationError as any)('PVE 400 /pools: {"message":"Parameter verification failed.","errors":{"poolid":"invalid format"}}', 400))

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p3' } })

    expect((await readJson<any>(res)).error).toBe('Parameter verification failed. invalid format')
  })

  it('still answers when the audit row cannot be written', async () => {
    pveFetchMock.mockResolvedValue(null)
    ;(audit as any).mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'c1' }, searchParams: { poolid: 'p3' } })

    expect(res.status).toBe(200)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('pools writes: failures', () => {
  it('audits a refused comment update and relays it', async () => {
    pveFetchMock.mockRejectedValue(new (PveApplicationError as any)('PVE 403 /pools: {"message":"Permission check failed (/pool/p1, Pool.Allocate)"}', 403))

    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'p1', comment: 'x' } })

    expect(res.status).toBe(403)
    expect((audit as any).mock.calls[0][0]).toMatchObject({ action: 'pool.update', status: 'failure' })
  })

  it('answers 404 for an unknown connection', async () => {
    getConnectionByIdMock.mockResolvedValue(null)

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'nope' }, body: { poolid: 'p1' } })

    expect(res.status).toBe(404)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
