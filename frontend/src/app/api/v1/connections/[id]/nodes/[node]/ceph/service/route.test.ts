import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1164: start / stop / restart of one Ceph daemon through
   POST /nodes/{node}/ceph/{action} service=<name>, with the ok-to-stop
   precheck (PVE cmd-safety, never SSH) before an OSD is stopped or restarted.
*/

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: async () => null }))
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
  executeSSH: vi.fn(async () => {
    throw new Error('executeSSH must not be called by the service route')
  }),
}))

import { POST } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { PveLicenseExcludedError } from '@/lib/license/exclusions'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any

const CONN_ID = 'conn-1'
const NODE = 'pve1'
const params = { id: CONN_ID, node: NODE }
const UPID = 'UPID:pve1:0001A2B3:00C4D5E6:68F7A8B9:srvstop:osd.0:root@pam:'

const CLUSTER_STATUS = [
  { type: 'cluster', name: 'lab', quorate: 1 },
  { type: 'node', name: 'pve1', online: 1, ip: '10.42.0.101' },
  { type: 'node', name: 'pve2', online: 1, ip: '10.42.0.102' },
]

const safeUrl = (node: string, id: number) => `/nodes/${node}/ceph/cmd-safety?service=osd&id=${id}&action=stop`
const NOT_OK_TO_STOP = { safe: false, status: 'unsafe to stop osd(s) at this time (33 PGs are or would become offline)' }
let safety: (node: string, id: number) => any = () => ({ safe: true })

const pveCalls = () => pveFetchMock.mock.calls.map((c: any[]) => [c[1], c[2]?.method ?? 'GET', c[2]?.body?.toString()])
const post = (body: Record<string, unknown>, p = params) => callRoute(POST, { params: p, method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  safety = () => ({ safe: true })
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/cluster/status') return CLUSTER_STATUS
    const m = /^\/nodes\/([^/]+)\/ceph\/cmd-safety\?service=osd&id=(\d+)&action=stop$/.exec(path)
    if (m) {
      const answer = safety(m[1], Number(m[2]))
      if (answer instanceof Error) throw answer
      return answer
    }
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

  it('asks PVE cmd-safety about the OSD, then stops it when safe, without SSH', async () => {
    const res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ data: { upid: UPID, action: 'stop', service: 'osd.0', forced: false } })
    expect(pveCalls()).toEqual([
      ['/cluster/status', 'GET', undefined],
      [safeUrl('pve1', 0), 'GET', undefined],
      ['/nodes/pve1/ceph/stop', 'POST', 'service=osd.0'],
    ])
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('restart of an OSD goes through the same precheck', async () => {
    expect((await post({ action: 'restart', service: 'osd.7' })).status).toBe(200)
    expect(pveCalls().map(([p]: any[]) => p)).toContain(safeUrl('pve1', 7))
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('409 not_ok_to_stop with the verdict, and nothing stopped, when PGs would go offline', async () => {
    safety = () => NOT_OK_TO_STOP
    const res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({ code: 'not_ok_to_stop', okToStop: { ok: false, osds: [0], numNotOkPgs: 33, message: null } })
    expect(body.error).toMatch(/33 PG/)
    expect(pveCalls().map(([p]: any[]) => p)).toEqual(['/cluster/status', safeUrl('pve1', 0)])
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('409 not_ok_to_stop when the verdict cannot be obtained, never a safe default, with a fixed text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    safety = () => new Error('PVE 501 /nodes/pve1/ceph/cmd-safety: Method not implemented, 10.42.0.101')
    let res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    let body = await readJson<any>(res)
    expect(body).toMatchObject({ code: 'not_ok_to_stop', error: 'Ceph could not be asked whether stopping is safe', okToStop: { ok: false, message: 'Ceph could not be asked whether stopping is safe' } })
    expect(JSON.stringify(body)).not.toContain('10.42.0.101')
    expect(spy.mock.calls.flat().join(' ')).toContain('10.42.0.101')

    safety = () => ({})
    res = await post({ action: 'stop', service: 'osd.0' })
    expect(res.status).toBe(409)
    body = await readJson<any>(res)
    expect(body).toMatchObject({ okToStop: { ok: false } })
    expect(pveCalls().filter(([, m]: any[]) => m === 'POST')).toEqual([])
    spy.mockRestore()
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
      if (path === safeUrl('pve2', 0)) return { safe: true }
      return UPID
    })
    const res = await post({ action: 'stop', service: 'osd.0' })

    expect(res.status).toBe(200)
    expect(pveCalls()).toEqual([
      ['/cluster/status', 'GET', undefined],
      [safeUrl('pve2', 0), 'GET', undefined],
      ['/nodes/pve1/ceph/stop', 'POST', 'service=osd.0'],
    ])
  })

  it('409 without a number of PGs says the stop is not safe, never 0 PG(s)', async () => {
    safety = () => ({ safe: false, status: 'unsafe to stop osd(s) at this time' })
    const res = await post({ action: 'stop', service: 'osd.0' })

    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Stopping osd.0 is not safe right now')
    expect(body.error).not.toMatch(/0 PG/)
    expect(body.okToStop).toMatchObject({ ok: false, numNotOkPgs: 0 })
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
