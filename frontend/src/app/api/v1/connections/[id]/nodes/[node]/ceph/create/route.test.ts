import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1164: creation of a monitor or a manager on a node, one PVE POST each,
   answered by a task UPID. No OSD: PVE keeps that to root@pam.
*/

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: (err: unknown) =>
    /connection not found/i.test((err as { message?: string } | null)?.message || ''),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildNodeResourceId: vi.fn<(connId: string, node: string) => string>((connId, node) => `${connId}:${node}`),
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage', STORAGE_ADMIN: 'storage.admin' },
}))

import { POST } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any

const CONN_ID = 'conn-1'
const params = { id: CONN_ID, node: 'pve1' }
const UPID = 'UPID:pve1:0001A2B3:00C4D5E6:68F7A8B9:cephcreatemgr:mgr.pve1:root@pam!root:'

const pveCalls = () => pveFetchMock.mock.calls.map((c: any[]) => [c[1], c[2]?.method, c[2]?.body?.toString()])
const post = (body: Record<string, unknown>, p = params) => callRoute(POST, { params: p, method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue(UPID)
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/create', () => {
  it('creates a monitor under the node name, with or without an address', async () => {
    let res = await post({ kind: 'mon' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { upid: UPID, node: 'pve1', kind: 'mon' } })
    res = await post({ kind: 'mon', 'mon-address': '10.42.0.101, 10.42.1.101' })
    expect(res.status).toBe(200)
    expect(pveCalls()).toEqual([
      ['/nodes/pve1/ceph/mon/pve1', 'POST', ''],
      ['/nodes/pve1/ceph/mon/pve1', 'POST', 'mon-address=10.42.0.101%2C10.42.1.101'],
    ])
  })

  it('400 on a monitor address that is not an IP list', async () => {
    const res = await post({ kind: 'mon', 'mon-address': 'pve1.lab' })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/IP address/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('creates a manager under the node name', async () => {
    const res = await post({ kind: 'mgr' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { upid: UPID, node: 'pve1', kind: 'mgr' } })
    expect(pveCalls()).toEqual([['/nodes/pve1/ceph/mgr/pve1', 'POST', '']])
  })

  it('400 when a node name cannot be a daemon id (dots), and on an unknown kind or a bad node name', async () => {
    let res = await post({ kind: 'mgr' }, { id: CONN_ID, node: 'pve1.lab' })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/cannot be used as a mgr id/)
    expect((await post({ kind: 'mon' }, { id: CONN_ID, node: 'pve_1' })).status).toBe(400)

    expect((await post({ kind: 'mds' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    // No OSD creation: PVE refuses it to an API token (root@pam only).
    res = await post({ kind: 'osd', dev: '/dev/sdd' })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('kind must be mon or mgr')
    res = await post({ kind: 'mgr' }, { id: CONN_ID, node: 'pve1; id' })
    expect(res.status).toBe(400)
    expect(pveCalls()).toEqual([])
  })

  it('403 without storage.admin, 403 with its code outside the license, 404 and 500 on errors', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post({ kind: 'mgr' })).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()

    pveFetchMock.mockRejectedValueOnce(new PveLicenseExcludedError(CONN_ID))
    let res = await post({ kind: 'mgr' })
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })

    getConnectionByIdMock.mockRejectedValueOnce(new Error('Connection not found: conn-1'))
    expect((await post({ kind: 'mgr' })).status).toBe(404)

    pveFetchMock.mockRejectedValueOnce(new Error("PVE 500 /nodes/pve1/ceph/mon/pve1: monitor address '10.42.0.101' already in use"))
    res = await post({ kind: 'mon' })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toMatch(/already in use/)
  })
})
