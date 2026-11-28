import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: pveceph init through PVE (an API token may run it, Sys.Modify),
   then the first monitor, which creates the first manager itself. Once init
   went through, the connection is flagged as running Ceph.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async () => ({ id: 'c1' })), isConnectionNotFoundError: () => false }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async (_c: unknown, n: string) => `ip-${n}`) }))
vi.mock('@/lib/ssh/verify-node-target', () => ({ verifyNodeTarget: vi.fn(async () => ({ ok: true })), sshTargetError: (_n: string, _t: unknown, f?: string) => f ?? 'unreachable' }))
const update = vi.fn(async () => ({}))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: vi.fn(async () => ({ connection: { update } })) }))

import { POST } from './route'
import { pveFetch } from '@/lib/proxmox/client'

const pveMock = pveFetch as any
const UPID = 'UPID:pve1:1:2:3:cephcreatemon:mon.pve1:root@pam!pxc:'
const body = { node: 'pve1', network: '10.42.0.0/24', size: 3, minSize: 2 }
const writes = () => pveMock.mock.calls.filter((c: any[]) => c[2]?.method).map((c: any[]) => [c[1], c[2].method, c[2].body?.toString()])

beforeEach(() => {
  vi.clearAllMocks()
  pveMock.mockImplementation(async (_c: any, path: string, opts?: any) => {
    if (path === '/nodes') return [{ node: 'pve1' }, { node: 'pve2' }]
    if (path === '/nodes/pve1/ceph/init') return null
    if (path === '/nodes/pve1/ceph/mon/pve1' && opts?.method === 'POST') return UPID
    throw new Error(`unexpected ${path}`)
  })
})

describe('POST /api/v1/connections/[id]/ceph/init', () => {
  it('initializes, creates the first monitor and flags the connection', async () => {
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST', body })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { upid: UPID, node: 'pve1', hasCeph: true } })
    expect(writes()).toEqual([
      ['/nodes/pve1/ceph/init', 'POST', 'network=10.42.0.0%2F24&size=3&min_size=2'],
      ['/nodes/pve1/ceph/mon/pve1', 'POST', ''],
    ])
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { hasCeph: true } })
  })

  it('leaves the connection alone when init fails', async () => {
    pveMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve1' }]
      throw new Error('Ceph Nautilus required - please run pveceph install')
    })
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST', body })
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Ceph Nautilus required - please run pveceph install' })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a bad network before any call, and a node of another cluster', async () => {
    let res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST', body: { ...body, network: '10.42.0.0/33' } })
    expect(res.status).toBe(400)
    expect(pveMock).not.toHaveBeenCalled()
    res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST', body: { ...body, node: 'pve9' } })
    expect(res.status).toBe(404)
  })
})
