import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: the first step of the deploy wizard. One read per node, when the
   wizard opens: Ceph state, PVE version, subscription, and whether the SSH
   account may run pveceph install there. An offline node is not asked.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async () => ({ id: 'c1' })), isConnectionNotFoundError: () => false }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async (_c: unknown, n: string) => `ip-${n}`) }))
vi.mock('@/lib/ssh/verify-node-target', () => ({ verifyNodeTarget: vi.fn(async () => ({ ok: true })), sshTargetError: (_n: string, _t: unknown, f?: string) => f ?? 'unreachable' }))
vi.mock('@/lib/ceph/detachedPveceph', () => ({ sudoAllows: vi.fn(async () => 'ok') }))

import { GET } from './route'
import { sudoAllows } from '@/lib/ceph/detachedPveceph'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'

const pveMock = pveFetch as any
const STATUS = [
  { type: 'cluster', name: 'LAB' },
  { type: 'node', name: 'pve1', online: 1, ip: '10.42.0.101' },
  { type: 'node', name: 'pve2', online: 1, ip: '10.42.0.102' },
  { type: 'node', name: 'pve3', online: 0, ip: '10.42.0.103' },
]

beforeEach(() => {
  vi.clearAllMocks()
  pveMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/cluster/status') return STATUS
    if (path === '/nodes/pve1/ceph/status') throw Object.assign(new Error('binary not installed: /usr/bin/ceph-mon'), { statusCode: 500 })
    if (path === '/nodes/pve2/ceph/status') throw new Error("pveceph configuration not initialized - missing '/etc/pve/ceph.conf'")
    if (path.endsWith('/version')) return { version: '9.2.26' }
    if (path === '/nodes/pve1/subscription') return { status: 'active' }
    if (path.endsWith('/subscription')) return { status: 'notfound' }
    if (path === '/nodes/pve1/ceph/releases') return [{ release: 'tentacle', available: 1 }, { release: 'squid', available: 1 }]
    throw new Error(`unexpected ${path}`)
  })
})

describe('GET /api/v1/connections/[id]/ceph/preflight', () => {
  it('reads each online node and leaves the offline one alone', async () => {
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        nodes: [
          { node: 'pve1', online: true, address: '10.42.0.101', ceph: 'absent', pveVersion: '9.2.26', repository: 'enterprise', ssh: 'ok' },
          { node: 'pve2', online: true, address: '10.42.0.102', ceph: 'installed', pveVersion: '9.2.26', repository: 'no-subscription', ssh: 'ok' },
          { node: 'pve3', online: false, address: '10.42.0.103', ceph: 'unknown', pveVersion: null, repository: 'no-subscription', ssh: null },
        ],
        releases: ['tentacle', 'squid'],
      },
    })
    expect((sudoAllows as any).mock.calls.map((c: any[]) => c[1])).toEqual(['ip-pve1', 'ip-pve2'])
    expect(pveMock.mock.calls.some((c: any[]) => String(c[1]).startsWith('/nodes/pve3/'))).toBe(false)
  })

  it('stops at the permission check', async () => {
    ;(checkPermission as any).mockResolvedValueOnce(new Response(null, { status: 403 }))
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(403)
    expect(pveMock).not.toHaveBeenCalled()
  })
})
