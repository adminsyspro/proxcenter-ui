import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1164: start / stop / restart of one Ceph daemon through
   POST /nodes/{node}/ceph/{action} service=<name>, with the ok-to-stop
   precheck over SSH before an OSD is stopped or restarted.
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

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: vi.fn<(...args: any[]) => Promise<string>>(),
}))
vi.mock('@/lib/ssh/node-endpoint', async () => {
  const nodeIp = await import('@/lib/ssh/node-ip')
  return {
    ...(await import('@/lib/ssh/node-endpoint-core')),
    resolveNodeSshEndpoint: async (conn: any, node: string) =>
      ({ host: await nodeIp.getNodeIp(conn, node), port: 22, source: 'proxmox' }),
  }
})

import { POST } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const getNodeIpMock = getNodeIp as any

const CONN_ID = 'conn-1'
const NODE = 'pve1'
const params = { id: CONN_ID, node: NODE }
const UPID = 'UPID:pve1:0001A2B3:00C4D5E6:68F7A8B9:srvstop:osd.0:root@pam:'

const CLUSTER_STATUS = [
  { type: 'cluster', name: 'lab', quorate: 1 },
  { type: 'node', name: 'pve1', online: 1, ip: '10.42.0.101' },
  { type: 'node', name: 'pve2', online: 1, ip: '10.42.0.102' },
]

const OK_TO_STOP = '{"ok_to_stop":true,"osds":[0],"num_ok_pgs":12,"num_not_ok_pgs":0,"ok_become_degraded":["1.0"]}\n'
const NOT_OK_TO_STOP = '{"ok_to_stop":false,"osds":[0],"num_ok_pgs":0,"num_not_ok_pgs":33,"bad_become_inactive":["1.0"]}\n'

const pveCalls = () => pveFetchMock.mock.calls.map((c: any[]) => [c[1], c[2]?.method ?? 'GET', c[2]?.body?.toString()])
const post = (body: Record<string, unknown>, p = params) => callRoute(POST, { params: p, method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  getNodeIpMock.mockImplementation(async (_c: any, node: string) => (node === 'pve2' ? '10.42.0.102' : '10.42.0.101'))
  executeSSHMock.mockResolvedValue({ success: true, output: OK_TO_STOP })
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/cluster/status') return CLUSTER_STATUS
    if (/\/ceph\/(start|stop|restart)$/.test(path)) return UPID
    throw new Error(`unexpected PVE path ${path}`)
  })
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/service', () => {
  it('starts a daemon with a form-encoded POST on the node, without any precheck', async () => {
    const res = await post({ action: 'start', service: 'mon.pve1' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { upid: UPID, node: NODE, service: 'mon.pve1', action: 'start', forced: false } })
    expect(pveCalls()).toEqual([['/nodes/pve1/ceph/start', 'POST', 'service=mon.pve1']])
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).toHaveBeenCalledWith('storage.admin', 'connection', CONN_ID)
  })

  it('stops a monitor or a manager without a precheck (ok-to-stop is for OSDs)', async () => {
    expect((await post({ action: 'stop', service: 'mon.pve1' })).status).toBe(200)
    expect((await post({ action: 'restart', service: 'mgr.pve1' })).status).toBe(200)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(pveCalls().filter(([p]: any[]) => p !== '/cluster/status')).toEqual([
      ['/nodes/pve1/ceph/stop', 'POST', 'service=mon.pve1'],
      ['/nodes/pve1/ceph/restart', 'POST', 'service=mgr.pve1'],
    ])
  })

  it('runs ok-to-stop on the OSD over read-only SSH, then stops it when safe', async () => {
    const res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ data: { upid: UPID, action: 'stop', service: 'osd.0', forced: false } })
    expect(executeSSHMock).toHaveBeenCalledWith(
      CONN_ID,
      expect.objectContaining({ host: '10.42.0.101' }),
      'ceph osd ok-to-stop 0 -f json 2>/dev/null; true',
      30_000,
      { readOnly: true },
    )
    expect(pveCalls()).toEqual([
      ['/cluster/status', 'GET', undefined],
      ['/nodes/pve1/ceph/stop', 'POST', 'service=osd.0'],
    ])
  })

  it('restart of an OSD goes through the same precheck', async () => {
    expect((await post({ action: 'restart', service: 'osd.7' })).status).toBe(200)
    expect(executeSSHMock.mock.calls[0][2]).toBe('ceph osd ok-to-stop 7 -f json 2>/dev/null; true')
  })

  it('409 not_ok_to_stop with the verdict, and nothing stopped, when PGs would go offline', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: NOT_OK_TO_STOP })
    const res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({ code: 'not_ok_to_stop', okToStop: { ok: false, osds: [0], numNotOkPgs: 33, message: null } })
    expect(body.error).toMatch(/33 PG/)
    expect(pveCalls().map(([p]: any[]) => p)).toEqual(['/cluster/status'])
  })

  it('409 not_ok_to_stop when the verdict cannot be obtained, never a safe default', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'ssh timeout' })
    let res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'not_ok_to_stop', error: 'ssh timeout', okToStop: { ok: false, message: 'ssh timeout' } })

    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'garbage' })
    res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ okToStop: { message: 'ceph osd ok-to-stop returned no verdict' } })
  })

  it('force: true skips the precheck and stops the OSD', async () => {
    const res = await post({ action: 'stop', service: 'osd.0', force: true })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ data: { forced: true } })
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(pveCalls()).toEqual([['/nodes/pve1/ceph/stop', 'POST', 'service=osd.0']])
  })

  it('runs the precheck through another online node while the host is down', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/status') return CLUSTER_STATUS.map(r => (r.name === 'pve1' ? { ...r, online: 0 } : r))
      return UPID
    })
    await post({ action: 'stop', service: 'osd.0' })
    expect(executeSSHMock.mock.calls[0][1]).toMatchObject({ host: '10.42.0.102' })
  })

  it('400 on an unknown action, a bad service name or a bad node name, before any call', async () => {
    expect((await post({ action: 'reload', service: 'osd.0' })).status).toBe(400)
    expect((await post({ service: 'osd.0' })).status).toBe(400)
    for (const service of ['osd', 'rgw.a', 'osd.0;id', 'mon.pve1.lab', 42, undefined]) {
      const res = await post({ action: 'stop', service })
      expect(res.status, String(service)).toBe(400)
    }
    expect((await post({ action: 'start', service: 'osd.0' }, { id: CONN_ID, node: 'pve1; id' })).status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('403 without storage.admin, 403 with its code outside the license, 404 and 500 on connection errors', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post({ action: 'start', service: 'osd.0' })).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()

    pveFetchMock.mockRejectedValueOnce(new PveLicenseExcludedError(CONN_ID))
    let res = await post({ action: 'start', service: 'osd.0' })
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })

    getConnectionByIdMock.mockRejectedValueOnce(new Error('Connection not found: conn-1'))
    expect((await post({ action: 'start', service: 'osd.0' })).status).toBe(404)

    pveFetchMock.mockRejectedValueOnce(new Error('PVE 500 /nodes/pve1/ceph/start: ceph service not found'))
    res = await post({ action: 'start', service: 'osd.0' })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toMatch(/ceph service not found/)
  })
})
