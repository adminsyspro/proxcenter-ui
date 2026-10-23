/**
 * GET /api/v1/connections/[id]/snapshots: the cluster-wide snapshot list. A
 * vDC session only gets the snapshots of the guests in its pools, decided on
 * the one /cluster/resources listing the route reads anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  getConnectionById: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  getTenantInfrastructureScope: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: unknown[]) => m.getTenantInfrastructureScope(...a),
}))

import { GET } from './route'

const RESOURCES = [
  { type: 'node', node: 'pve1', status: 'online' },
  { type: 'qemu', vmid: 100, name: 'web', node: 'pve1', pool: 'pool-1', status: 'running' },
  { type: 'lxc', vmid: 101, name: 'db', node: 'pve2', pool: 'pool-1', status: 'running' },
  { type: 'qemu', vmid: 200, name: 'provider-vm', node: 'pve1', pool: 'provider', status: 'running' },
]

const iaas = () => ({
  kind: 'iaas',
  vdcScope: {
    connectionIds: new Set(['c1']),
    nodesByConnection: new Map([['c1', new Set(['pve1', 'pve2'])]]),
    poolsByConnection: new Map([['c1', new Set(['pool-1'])]]),
  },
})

const call = (searchParams?: Record<string, string>) => callRoute(GET as any, { params: { id: 'c1' }, searchParams })
const snapshotCalls = () => m.pveFetch.mock.calls.map(c => String(c[1])).filter(p => p.endsWith('/snapshot'))

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.getConnectionById.mockResolvedValue({ id: 'c1' })
  m.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
  m.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources') return RESOURCES
    if (path.endsWith('/snapshot')) return [{ name: 'current' }, { name: `snap-${path.split('/')[4]}`, snaptime: 10 }]
    throw new Error(`unexpected ${path}`)
  })
})

describe('GET /api/v1/connections/[id]/snapshots', () => {
  it('lists the snapshots of every guest for a provider session', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.snapshots.map((s: any) => s.vmid).sort()).toEqual([100, 101, 200])
    expect(body.data.vmCount).toBe(3)
    expect(m.pveFetch).not.toHaveBeenCalledWith(expect.anything(), '/cluster/resources?type=vm')
  })

  it('lists only the guests of the tenant pools for a vDC session, from the one listing already read', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    const res = await call()
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.snapshots.map((s: any) => s.vmid).sort()).toEqual([100, 101])
    expect(body.data.totalCount).toBe(2)
    expect(snapshotCalls()).toEqual(['/nodes/pve1/qemu/100/snapshot', '/nodes/pve2/lxc/101/snapshot'])
    expect(m.pveFetch).not.toHaveBeenCalledWith(expect.anything(), '/cluster/resources?type=vm')
  })

  it('keeps the node filter on top of the vDC mask', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    const body = await readJson<any>(await call({ node: 'pve2' }))
    expect(body.data.snapshots.map((s: any) => s.vmid)).toEqual([101])
  })

  it('hides a vDC-pool guest that runs on a node outside the vDC', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue({
      ...iaas(),
      vdcScope: { ...iaas().vdcScope, nodesByConnection: new Map([['c1', new Set(['pve1'])]]) },
    })
    const body = await readJson<any>(await call())
    expect(body.data.snapshots.map((s: any) => s.vmid)).toEqual([100])
  })

  it('answers 503 when the vDC scope cannot be verified, rather than an unmasked list', async () => {
    m.getTenantInfrastructureScope.mockRejectedValue(new Error('db down'))
    expect((await call()).status).toBe(503)
    expect(snapshotCalls()).toEqual([])
  })

  it('leaves an RBAC refusal to checkPermission', async () => {
    m.checkPermission.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.pveFetch).not.toHaveBeenCalled()
  })
})
