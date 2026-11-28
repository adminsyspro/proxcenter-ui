import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: edit and deletion of a pool. PVE wants the parameters of a DELETE
   in the query string (a form body answers 501, measured 28/11/2026). A pool
   that still holds guest disks on its PVE storages is not deleted.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: (err: unknown) => /connection not found/i.test((err as { message?: string } | null)?.message || ''),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' },
}))
vi.mock('@/lib/ceph/poolGuests', () => ({ findPoolGuestDisks: vi.fn() }))

import { DELETE, PUT } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { findPoolGuestDisks } from '@/lib/ceph/poolGuests'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'

const pveFetchMock = pveFetch as any
const guestsMock = findPoolGuestDisks as any
const UPID = 'UPID:pve1:000B2555:0C91BE75:6B0A7200:cephdestroypool:vm-pool:root@pam!pxc:'
const STATUS = [{ type: 'node', name: 'pve1', online: 1 }, { type: 'node', name: 'pve2', online: 1 }]
const params = { id: 'c1', pool: 'vm-pool' }
const writes = () => pveFetchMock.mock.calls.filter((c: any[]) => c[2]?.method).map((c: any[]) => [c[1], c[2].method, c[2].body?.toString()])

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  guestsMock.mockResolvedValue({ storages: ['vm-pool'], disks: [], unreadable: [] })
  pveFetchMock.mockImplementation(async (_c: any, path: string, opts?: any) => {
    if (path === '/cluster/status') return STATUS
    if (opts?.method) return UPID
    throw new Error(`unexpected ${path}`)
  })
})

describe('PUT /api/v1/connections/[id]/ceph/pools/[pool]', () => {
  it('sends the editable fields', async () => {
    const res = await callRoute(PUT, { params, method: 'PUT', body: { size: 3, minSize: 2, autoscale: 'warn', targetRatio: 0.1 } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve1' } })
    expect(writes()).toEqual([['/nodes/pve1/ceph/pool/vm-pool', 'PUT', 'size=3&min_size=2&pg_autoscale_mode=warn&target_size_ratio=0.1']])
  })

  it('refuses a bad pool name in the path', async () => {
    const res = await callRoute(PUT, { params: { id: 'c1', pool: '..' }, method: 'PUT', body: { size: 3, minSize: 2 } })
    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('refuses min_size above size', async () => {
    const res = await callRoute(PUT, { params, method: 'PUT', body: { size: 2, minSize: 3 } })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/connections/[id]/ceph/pools/[pool]', () => {
  it('deletes the pool and its storages, parameters in the query string', async () => {
    const res = await callRoute(DELETE, { params, method: 'DELETE', searchParams: { removeStorages: '1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve1' } })
    expect(writes()).toEqual([['/nodes/pve1/ceph/pool/vm-pool?remove_storages=1', 'DELETE', undefined]])
    expect(guestsMock).toHaveBeenCalledWith({ id: 'c1' }, 'pve1', 'vm-pool')
  })

  it('keeps the storages when asked', async () => {
    await callRoute(DELETE, { params, method: 'DELETE' })
    expect(writes()).toEqual([['/nodes/pve1/ceph/pool/vm-pool', 'DELETE', undefined]])
  })

  it('refuses a pool that still holds guest disks', async () => {
    guestsMock.mockResolvedValue({ storages: ['vm-pool'], disks: ['vm-pool:vm-100-disk-0'], unreadable: [] })
    const res = await callRoute(DELETE, { params, method: 'DELETE', searchParams: { removeStorages: '1' } })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'POOL_HAS_GUEST_DISKS', disks: ['vm-pool:vm-100-disk-0'] })
    expect(writes()).toEqual([])
  })

  it('refuses when a storage of the pool cannot be read', async () => {
    guestsMock.mockResolvedValue({ storages: ['vm-pool'], disks: [], unreadable: ['vm-pool'] })
    const res = await callRoute(DELETE, { params, method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'POOL_GUESTS_UNKNOWN', storages: ['vm-pool'] })
    expect(writes()).toEqual([])
  })

  it('stops at the permission check', async () => {
    ;(checkPermission as any).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await callRoute(DELETE, { params, method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
