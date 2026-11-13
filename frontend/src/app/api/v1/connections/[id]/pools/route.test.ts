import { describe, it, expect, vi, beforeEach } from 'vitest'


// The IaaS tenant gate of this route is covered by lib/tenant/iaasGuard.routes.test.ts
// and lib/connections/iaasView.routes.test.ts (roadmap#189); the caller here is the provider.
vi.mock("@/lib/tenant/iaasGuard", () => ({
  denyIaasTenant: async () => null,
  resolveCallerInfraScope: async () => ({ ok: true, tenantId: "default", infra: { kind: "provider" } }),
}))

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

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
vi.mock('@/lib/cache/guestSetRefresh', () => ({ refreshCachedGuests: vi.fn<(...args: any[]) => Promise<void>>() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { vdc: { findFirst: vi.fn<(...args: any[]) => Promise<any>>(), findMany: vi.fn<(...args: any[]) => Promise<any[]>>() } },
}))

import { GET, POST, PUT, DELETE } from './route'
import { audit } from '@/lib/audit'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { prisma } from '@/lib/db/prisma'
import { refreshCachedGuests } from '@/lib/cache/guestSetRefresh'
import { checkPermission, getRequestGuestScopePerimeter } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch, PveApplicationError } from '@/lib/proxmox/client'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

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
  ;(prisma.vdc.findMany as any).mockResolvedValue([])
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

  it('answers 403 with its code when the cluster is outside the license (roadmap#58)', async () => {
    // pveFetch refused the write itself, before any request: the route must
    // say so with the code the UI recognises, not a generic 500.
    pveFetchMock.mockRejectedValue(new PveLicenseExcludedError('c1'))

    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'c1' }, body: { poolid: 'p1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })
    expect(body.error).toBe('This cluster is outside the license: ProxCenter refuses any change on it.')
    expect(invalidateInventoryCache).not.toHaveBeenCalled()
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

describe('GET /api/v1/connections/[id]/pools?poolid=: members', () => {
  const members = [
    { id: 'lxc/7001', type: 'lxc', vmid: 7001, node: 'n2', name: 'web', status: 'running', template: 0 },
    { id: 'qemu/101', type: 'qemu', vmid: 101, node: 'n1', name: 'db', status: 'stopped', template: 1 },
    { id: 'storage/n1/local-lvm', type: 'storage', storage: 'local-lvm', node: 'n1', plugintype: 'lvmthin', shared: 0 },
    { id: 'storage/n1/ceph', type: 'storage', storage: 'ceph', node: 'n1', plugintype: 'rbd', shared: 1 },
    { id: 'storage/n2/ceph', type: 'storage', storage: 'ceph', node: 'n2', plugintype: 'rbd', shared: 1 },
  ]

  it('reads the members on the PVE 8.1+ form and lists each storage once', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ poolid: 'p1', comment: 'first pool' }])
      .mockResolvedValueOnce([{ poolid: 'p1', comment: 'first pool', members }])

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid: 'p1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls[1][1]).toBe('/pools?poolid=p1')
    expect(body.data.comment).toBe('first pool')
    expect(body.data.guests).toEqual([
      { vmid: 101, type: 'qemu', node: 'n1', name: 'db', status: 'stopped', template: true },
      { vmid: 7001, type: 'lxc', node: 'n2', name: 'web', status: 'running', template: false },
    ])
    expect(body.data.storages).toEqual([
      { storage: 'ceph', type: 'rbd', shared: true, nodes: ['n1', 'n2'] },
      { storage: 'local-lvm', type: 'lvmthin', shared: false, nodes: ['n1'] },
    ])
  })

  it('falls back to /pools/{poolid} on a PVE 8.0 that refuses the parameter', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ poolid: 'p1' }])
      .mockRejectedValueOnce(new (PveApplicationError as any)('PVE 400 /pools: bad param', 400))
      .mockResolvedValueOnce({ members: members.slice(0, 1) })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid: 'p1' } })
    const body = await readJson<any>(res)

    expect(pveFetchMock.mock.calls[2][1]).toBe('/pools/p1')
    expect(body.data.guests.map((g: any) => g.vmid)).toEqual([7001])
  })

  it('falls back too when PVE 8.0 ignores the parameter and lists the pools', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ poolid: 'p1' }])
      .mockResolvedValueOnce([{ poolid: 'p1' }])
      .mockResolvedValueOnce({})

    const body = await readJson<any>(await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid: 'p1' } }))

    expect(body.data).toEqual({ poolid: 'p1', comment: null, guests: [], storages: [] })
  })

  it('never reads the legacy path for a nested id', async () => {
    pveFetchMock.mockResolvedValueOnce([{ poolid: 'a/b' }]).mockResolvedValueOnce([])

    const body = await readJson<any>(await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid: 'a/b' } }))

    expect(pveFetchMock).toHaveBeenCalledTimes(2)
    expect(body.data.guests).toEqual([])
  })

  it('relays any other Proxmox failure', async () => {
    pveFetchMock.mockResolvedValueOnce([{ poolid: 'p1' }]).mockRejectedValueOnce(new Error('boom'))

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid: 'p1' } })

    expect(res.status).toBe(500)
  })

  it.each(['p9', '../x'])('answers 404 for a pool outside the visible list (%j)', async poolid => {
    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' }, searchParams: { poolid } })

    expect(res.status).toBe(404)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('PUT /api/v1/connections/[id]/pools: members', () => {
  const put = (body: any) => callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid: 'p1', ...body } })

  it('adds guests and storages in one PVE 8.1+ call and patches the cached guests', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await put({ vms: [101, '102', 101], storage: ['local-lvm'] })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(pveCall()).toEqual({ path: '/pools', method: 'PUT', body: { poolid: 'p1', vms: '101,102', storage: 'local-lvm' } })
    expect(body.data).toEqual({ poolid: 'p1', vms: [101, 102], storage: ['local-lvm'], delete: false })
    expect(refreshCachedGuests).toHaveBeenCalledWith('c1', { id: 'c1' })
    expect(invalidateInventoryCache).not.toHaveBeenCalled()
    expect((audit as any).mock.calls[0][0]).toMatchObject({ action: 'pool.update', status: 'success', details: { members: 'add', vms: ['101', '102'] } })
  })

  it('removes members with delete, and leaves the guest cache alone for storages only', async () => {
    pveFetchMock.mockResolvedValue(null)

    await put({ storage: ['local-lvm'], delete: true, allowMove: true })

    expect(pveCall().body).toEqual({ poolid: 'p1', storage: 'local-lvm', delete: '1' })
    expect(refreshCachedGuests).not.toHaveBeenCalled()
  })

  it('moves a guest from a plain pool with allow-move', async () => {
    pveFetchMock.mockResolvedValueOnce([{ vmid: 101, pool: 'other' }, { vmid: 200, pool: 'vdc-x' }]).mockResolvedValueOnce(null)

    const res = await put({ vms: [101], allowMove: true })

    expect(res.status).toBe(200)
    expect((prisma.vdc.findMany as any).mock.calls[1][0].where.pvePoolName.in).toEqual(['other'])
    expect(pveCall(1).body).toEqual({ poolid: 'p1', vms: '101', 'allow-move': '1' })
  })

  it('refuses to move a guest out of a vDC pool', async () => {
    pveFetchMock.mockResolvedValueOnce([{ vmid: 101, pool: 'acme' }])
    ;(prisma.vdc.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([{ pvePoolName: 'acme' }])

    const res = await put({ vms: [101], allowMove: true })
    const body = await readJson<any>(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe('GUEST_IN_VDC_POOL')
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a vDC row', 'p1', [{ pvePoolName: 'p1' }]],
    ['the vdc- prefix', 'vdc-acme-prod', []],
  ])('keeps a vDC pool out of reach (%s)', async (_label, poolid, rows) => {
    ;(prisma.vdc.findMany as any).mockResolvedValueOnce(rows)

    for (const extra of [{ vms: [101] }, { storage: ['ceph'], delete: true }]) {
      const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'c1' }, body: { poolid, ...extra } })

      expect(res.status).toBe(409)
      ;(prisma.vdc.findMany as any).mockResolvedValueOnce(rows)
    }
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ vms: '101' }, 'vms and storage must be arrays'],
    [{ vms: [] }, 'Nothing to add or remove'],
    [{ vms: ['12'] }, 'Invalid guest id'],
    [{ storage: ['bad id'] }, 'Invalid storage id'],
  ])('refuses the malformed change %j', async (extra, error) => {
    const res = await put(extra)

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe(error)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('relays and audits a Proxmox refusal', async () => {
    pveFetchMock.mockRejectedValueOnce(new (PveApplicationError as any)(
      'PVE 500 /pools: {"message":"VM 101 belongs already to pool \'x\' and \'allow-move\' is not set"}', 500))

    const res = await put({ vms: [101] })

    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toContain('allow-move')
    expect((audit as any).mock.calls[0][0]).toMatchObject({ status: 'failure' })
    expect(refreshCachedGuests).not.toHaveBeenCalled()
  })

  it('falls back to /pools/{poolid} on PVE 8.0 with the same fields', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new (PveApplicationError as any)('PVE 501 /pools: not implemented', 501))
      .mockResolvedValueOnce(null)

    await put({ vms: [101], delete: true })

    expect(pveCall(1)).toEqual({ path: '/pools/p1', method: 'PUT', body: { vms: '101', delete: '1' } })
  })
})
