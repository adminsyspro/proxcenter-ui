import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: creation of an OSD on a free disk. PVE refuses it to an API token
   (root@pam only, measured on PVE 9.2), so pveceph runs over SSH, detached,
   under the pinned rule of the ceph-provisioning sudo profile. Nothing runs
   when the account may not run that exact command.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: () => false,
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn<(...args: any[]) => Promise<any>>(), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async () => ({ host: '10.42.0.101', port: 22 })) }))
vi.mock('@/lib/ssh/verify-node-target', () => ({ verifyNodeTarget: vi.fn(async () => ({ ok: true })), sshTargetError: (_n: string, _t: unknown, f?: string) => f ?? 'unreachable' }))
vi.mock('@/lib/ceph/detachedPveceph', async (orig) => ({ ...(await orig<typeof import('@/lib/ceph/detachedPveceph')>()), sudoAllows: vi.fn(), runDetached: vi.fn(), followDetachedTask: vi.fn() }))

import { POST } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { followDetachedTask, runDetached, sudoAllows } from '@/lib/ceph/detachedPveceph'
import { pveFetch } from '@/lib/proxmox/client'
import { verifyNodeTarget } from '@/lib/ssh/verify-node-target'

const sudoMock = sudoAllows as any
const runMock = runDetached as any
const followMock = followDetachedTask as any
const UPID = 'UPID:pve1:000C1:0D2:6B0A8:cephcreateosd:sdb:root@pam:'
const params = { id: 'c1', node: 'pve1' }
const post = (body: Record<string, unknown>, p = params) => callRoute(POST, { params: p, method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1', host: '10.42.0.101' })
  ;(pveFetch as any).mockImplementation(async (_c: any, path: string) => (path === '/nodes' ? [{ node: 'pve1' }, { node: 'pve2' }] : null))
  sudoMock.mockResolvedValue('ok')
  runMock.mockResolvedValue({ started: true, logPath: '$HOME/.cache/proxcenter/ceph-osd-create-sdb.log' })
  followMock.mockResolvedValue({ upid: UPID })
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/osd', () => {
  it('runs pveceph osd create on the node and answers the task UPID', async () => {
    const res = await post({ dev: '/dev/sdb', dbDev: '/dev/nvme0n1', dbSizeGiB: 60 })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve1' } })
    const argv = ['/usr/bin/pveceph', 'osd', 'create', '/dev/sdb', '--db_dev', '/dev/nvme0n1', '--db_dev_size', '60']
    expect(sudoMock).toHaveBeenCalledWith('c1', { host: '10.42.0.101', port: 22 }, argv)
    expect(runMock).toHaveBeenCalledWith('c1', { host: '10.42.0.101', port: 22 }, argv, 'ceph-osd-create-sdb')
    expect(followMock.mock.calls[0][4]).toMatchObject({ tag: 'ceph-osd-create-sdb', taskType: 'cephcreateosd', taskId: 'sdb' })
  })

  it('leaves out the earlier tasks of the same disk when it looks for the new one', async () => {
    const OLD = 'UPID:pve1:000A1:0C1:6B0A1:cephcreateosd:sdb:root@pam:'
    ;(pveFetch as any).mockImplementation(async (_c: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve1' }]
      if (path.startsWith('/nodes/pve1/tasks')) return [{ type: 'cephcreateosd', id: 'sdb', upid: OLD }, { type: 'cephcreateosd', id: 'sdc', upid: 'other' }]
      return null
    })
    await post({ dev: '/dev/sdb' })
    expect(followMock.mock.calls[0][4].exclude).toEqual([OLD])
  })

  it('runs nothing when the sudo rule is missing', async () => {
    sudoMock.mockResolvedValue('missing-rule')
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(412)
    expect(await readJson(res)).toMatchObject({ code: 'SUDO_RULE_MISSING' })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('says when SSH is off for the connection', async () => {
    sudoMock.mockResolvedValue('ssh-disabled')
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(412)
    expect(await readJson(res)).toMatchObject({ code: 'SSH_DISABLED' })
  })

  it('returns what pveceph printed when it failed before any task', async () => {
    followMock.mockResolvedValue({ failed: "device '/dev/sdb' is already in use" })
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(422)
    expect(await readJson(res)).toMatchObject({ code: 'PVECEPH_FAILED', output: "device '/dev/sdb' is already in use" })
  })

  it('answers 202 when the task could not be found yet', async () => {
    followMock.mockResolvedValue({ pending: true })
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ data: { pending: true, node: 'pve1' } })
  })

  it('refuses a device a command could not take, before any SSH', async () => {
    const res = await post({ dev: '/dev/sdb;reboot' })
    expect(res.status).toBe(400)
    expect(sudoMock).not.toHaveBeenCalled()
  })

  it('refuses a node of another cluster', async () => {
    const res = await post({ dev: '/dev/sdb' }, { id: 'c1', node: 'pve9' })
    expect(res.status).toBe(404)
    expect(sudoMock).not.toHaveBeenCalled()
  })

  it('stops when the SSH target is not the node', async () => {
    ;(verifyNodeTarget as any).mockResolvedValue({ ok: false, status: 502, error: 'node mismatch' })
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(502)
    expect(sudoMock).not.toHaveBeenCalled()
  })

  it('stops at the permission check', async () => {
    ;(checkPermission as any).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await post({ dev: '/dev/sdb' })
    expect(res.status).toBe(403)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
