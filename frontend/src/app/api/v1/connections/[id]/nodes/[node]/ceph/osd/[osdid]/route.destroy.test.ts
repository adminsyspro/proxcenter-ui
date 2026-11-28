import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: destruction of an OSD. Only an OSD already out and down, on the
   node that hosts it, once PVE's cmd-safety says destroying it is safe. Then
   pveceph over SSH (PVE refuses the DELETE to an API token).
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(), isConnectionNotFoundError: () => false }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn<(...args: any[]) => Promise<any>>(), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async () => ({ host: '10.42.0.102', port: 22 })) }))
vi.mock('@/lib/ssh/verify-node-target', () => ({ verifyNodeTarget: vi.fn(async () => ({ ok: true })), sshTargetError: (_n: string, _t: unknown, f?: string) => f ?? 'unreachable' }))
vi.mock('@/lib/ceph/detachedPveceph', async (orig) => ({ ...(await orig<typeof import('@/lib/ceph/detachedPveceph')>()), sudoAllows: vi.fn(), runDetached: vi.fn(), followDetachedTask: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

import { DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { followDetachedTask, runDetached, sudoAllows } from '@/lib/ceph/detachedPveceph'
import { pveFetch } from '@/lib/proxmox/client'

const pveMock = pveFetch as any
const runMock = runDetached as any
const UPID = 'UPID:pve2:000C1:0D2:6B0A8:cephdestroyosd:osd.3:root@pam:'
const params = { id: 'c1', node: 'pve2', osdid: '3' }
const del = (p = params, cleanup = true) => callRoute(DELETE, { params: p, method: 'DELETE', searchParams: cleanup ? { cleanup: '1' } : undefined })

const tree = (osd: Record<string, unknown>) => ({
  flags: '',
  root: { children: [{ type: 'root', name: 'default', children: [
    { type: 'host', name: 'pve1', children: [{ type: 'osd', id: 0, name: 'osd.0', status: 'up', in: 1 }] },
    { type: 'host', name: 'pve2', children: [{ type: 'osd', id: 3, name: 'osd.3', ...osd }] },
  ] }] },
})

let safety: unknown = { safe: true }
let osdState: Record<string, unknown> = { status: 'down', in: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  safety = { safe: true }
  osdState = { status: 'down', in: 0 }
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  pveMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/cluster/status') return [{ type: 'node', name: 'pve2', online: 1 }]
    if (path === '/nodes/pve2/ceph/osd') return tree(osdState)
    if (path.startsWith('/nodes/pve2/ceph/cmd-safety')) return safety
    throw new Error(`unexpected ${path}`)
  })
  ;(sudoAllows as any).mockResolvedValue('ok')
  runMock.mockResolvedValue({ started: true, logPath: 'x' })
  ;(followDetachedTask as any).mockResolvedValue({ upid: UPID })
})

describe('DELETE /api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]', () => {
  it('destroys an out and down OSD with its disk, once cmd-safety agrees', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve2' } })
    expect(pveMock.mock.calls.map((c: any[]) => c[1])).toContain('/nodes/pve2/ceph/cmd-safety?service=osd&id=3&action=destroy')
    expect(runMock).toHaveBeenCalledWith('c1', { host: '10.42.0.102', port: 22 }, ['/usr/bin/pveceph', 'osd', 'destroy', '3', '--cleanup', '1'], 'ceph-osd-destroy-3')
    expect((followDetachedTask as any).mock.calls[0][4]).toMatchObject({ taskType: 'cephdestroyosd', taskId: 'osd.3' })
  })

  it('keeps the disk without cleanup', async () => {
    await del(params, false)
    expect(runMock.mock.calls[0][2]).toEqual(['/usr/bin/pveceph', 'osd', 'destroy', '3'])
  })

  it('refuses an OSD still in or up', async () => {
    osdState = { status: 'down', in: 1 }
    let res = await del()
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'OSD_NOT_OUT_DOWN' })
    osdState = { status: 'up', in: 0 }
    res = await del()
    expect(res.status).toBe(409)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('refuses when Ceph says destroying it is not safe, or gives no verdict', async () => {
    safety = { safe: false, status: 'unsafe (4 PGs are degraded)' }
    let res = await del()
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'OSD_NOT_SAFE', numNotOkPgs: 4 })
    safety = {}
    res = await del()
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'OSD_NOT_SAFE' })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('refuses an OSD the node does not host', async () => {
    const res = await del({ id: 'c1', node: 'pve2', osdid: '0' })
    expect(res.status).toBe(400)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('refuses a bad OSD id', async () => {
    const res = await del({ id: 'c1', node: 'pve2', osdid: '3;reboot' })
    expect(res.status).toBe(400)
    expect(pveMock).not.toHaveBeenCalled()
  })

  it('runs nothing without the sudo rule', async () => {
    ;(sudoAllows as any).mockResolvedValue('missing-rule')
    const res = await del()
    expect(res.status).toBe(412)
    expect(runMock).not.toHaveBeenCalled()
  })
})
