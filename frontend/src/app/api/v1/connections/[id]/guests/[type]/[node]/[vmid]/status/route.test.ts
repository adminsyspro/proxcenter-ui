/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/status. A vDC
 * session only reads the status of guests inside its pools; a guest that
 * moved to another vDC node since the URL was built is still served.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  getConnectionById: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  locateVmInCluster: vi.fn<(...a: any[]) => Promise<any>>(),
  getTenantInfrastructureScope: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/proxmox/locateVm', async io => ({
  ...await io<typeof import('@/lib/proxmox/locateVm')>(),
  locateVmInCluster: (...a: unknown[]) => m.locateVmInCluster(...a),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: unknown[]) => m.getTenantInfrastructureScope(...a),
}))

import { GET } from './route'

const PARAMS = { id: 'c1', type: 'qemu', node: 'pve1', vmid: '100' }
const call = (params: Record<string, string> = PARAMS) => callRoute(GET as any, { params })

const iaas = () => ({
  kind: 'iaas',
  vdcScope: {
    connectionIds: new Set(['c1']),
    nodesByConnection: new Map([['c1', new Set(['pve1', 'pve2'])]]),
    poolsByConnection: new Map([['c1', new Set(['pool-1'])]]),
  },
})

const STATUS = { status: 'running', name: 'web-1', uptime: 42, cpu: 0.1, mem: 1, maxmem: 2, disk: 0, maxdisk: 10 }

/** Serve the cluster listing and the status of the guest on `node` only. */
function cluster(resources: unknown[], node = 'pve1') {
  m.pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === '/cluster/resources?type=vm') return resources
    if (path === `/nodes/${node}/qemu/100/status/current`) return STATUS
    throw new Error(`Configuration file 'nodes/${path.split('/')[2]}/qemu-server/100.conf' does not exist`)
  })
}

const statusCalls = () => m.pveFetch.mock.calls.filter(c => String(c[1]).endsWith('/status/current'))

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.getConnectionById.mockResolvedValue({ id: 'c1' })
  m.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
  cluster([{ vmid: 100, type: 'qemu', node: 'pve1', pool: 'pool-1' }])
})

describe('GET .../status', () => {
  it('returns the guest status for a provider session', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { ...STATUS }, movedTo: null })
    expect(statusCalls()[0][1]).toBe('/nodes/pve1/qemu/100/status/current')
  })

  it('serves a guest inside the tenant vDC pools', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    expect((await call()).status).toBe(200)
  })

  it('refuses a guest outside the tenant vDC pools and reads no status', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    cluster([{ vmid: 100, type: 'qemu', node: 'pve1', pool: 'provider' }])
    const res = await call()
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: 'Guest outside your vDC scope' })
    expect(statusCalls()).toHaveLength(0)
  })

  it('still serves a vDC guest that moved to another vDC node, naming it in movedTo', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    cluster([{ vmid: 100, type: 'qemu', node: 'pve2', pool: 'pool-1' }], 'pve2')
    m.locateVmInCluster.mockResolvedValue({ node: 'pve2' })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).movedTo).toBe('pve2')
  })

  it('refuses a vDC guest that moved to a node outside the vDC', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    cluster([{ vmid: 100, type: 'qemu', node: 'pve9', pool: 'pool-1' }], 'pve9')
    expect((await call()).status).toBe(403)
    expect(statusCalls()).toHaveLength(0)
  })

  it('answers 503 when the vDC scope cannot be verified', async () => {
    m.getTenantInfrastructureScope.mockRejectedValue(new Error('db down'))
    expect((await call()).status).toBe(503)
    expect(statusCalls()).toHaveLength(0)
  })

  it.each([
    ['a vmid that is not digits', { ...PARAMS, vmid: '100/config' }],
    ['an unknown guest type', { ...PARAMS, type: 'ct' }],
    ['a node that is not a hostname', { ...PARAMS, node: 'pve 1' }],
  ])('answers 400 for %s without reaching Proxmox', async (_label, params) => {
    expect((await call(params)).status).toBe(400)
    expect(m.pveFetch).not.toHaveBeenCalled()
  })
})
