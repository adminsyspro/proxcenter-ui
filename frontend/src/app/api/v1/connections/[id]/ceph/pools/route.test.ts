import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: creation of a replicated pool through PVE (an API token may create
   one: measured on the lab, 28/11/2026). The call goes through an online node.
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

import { POST } from './route'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const UPID = 'UPID:pve1:000B21DA:0C91AE50:6B0A71D7:cephcreatepool:vm-pool:root@pam!pxc:'
const STATUS = [
  { type: 'cluster', name: 'PVE' },
  { type: 'node', name: 'pve1', online: 1 },
  { type: 'node', name: 'pve2', online: 1 },
]

const body = { name: 'vm-pool', size: 3, minSize: 2, autoscale: 'on', application: 'rbd', addStorage: true }
const post = (b: Record<string, unknown> = body) => callRoute(POST, { params: { id: 'c1' }, method: 'POST', body: b })
const writes = () => pveFetchMock.mock.calls.filter((c: any[]) => c[2]?.method).map((c: any[]) => [c[1], c[2].method, c[2].body?.toString()])

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  pveFetchMock.mockImplementation(async (_c: any, path: string, opts?: any) => {
    if (path === '/cluster/status') return STATUS
    if (opts?.method === 'POST') return UPID
    throw new Error(`unexpected ${path}`)
  })
})

describe('POST /api/v1/connections/[id]/ceph/pools', () => {
  it('creates the pool on the first online node, pg_num 32, with its storage', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve1' } })
    expect(writes()).toEqual([
      ['/nodes/pve1/ceph/pool', 'POST', 'name=vm-pool&size=3&min_size=2&pg_num=32&pg_autoscale_mode=on&application=rbd&add_storages=1'],
    ])
  })

  it('goes through another node when the first one is offline', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string, opts?: any) => {
      if (path === '/cluster/status') return [{ type: 'node', name: 'pve1', online: 0 }, { type: 'node', name: 'pve2', online: 1 }]
      if (opts?.method === 'POST') return UPID
      throw new Error(`unexpected ${path}`)
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(writes()[0][0]).toBe('/nodes/pve2/ceph/pool')
  })

  it('answers 503 when no node is online', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => (path === '/cluster/status' ? [{ type: 'node', name: 'pve1', online: 0 }] : UPID))
    const res = await post()
    expect(res.status).toBe(503)
    expect(writes()).toEqual([])
  })

  it('refuses min_size 1 with a 400, before any PVE call', async () => {
    const res = await post({ ...body, minSize: 1 })
    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('stops at the permission check', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 }))
    const res = await post()
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('storage.admin', 'connection', 'c1')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('hides Ceph from an IaaS tenant', async () => {
    ;(denyIaasTenantCeph as any).mockResolvedValueOnce(new Response(null, { status: 404 }))
    const res = await post()
    expect(res.status).toBe(404)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the PVE error message on a failure', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return STATUS
      throw new Error("pool 'vm-pool' already exists")
    })
    const res = await post()
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "pool 'vm-pool' already exists" })
  })

  it('answers the license code on a cluster outside the license', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return STATUS
      throw new PveLicenseExcludedError('c1')
    })
    const res = await post()
    expect(res.status).toBe(403)
  })
})
