/**
 * POST /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/[action]: power
 * actions. A vDC session is confined to the guests of its own pools, and the
 * path segments must be a guest type, a hostname and digits before Proxmox
 * is asked anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

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
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_START: 'vm.start', VM_STOP: 'vm.stop', VM_RESTART: 'vm.restart', VM_SUSPEND: 'vm.suspend' },
}))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: unknown[]) => m.getTenantInfrastructureScope(...a),
}))

import { POST } from './route'

const PARAMS = { id: 'c1', type: 'qemu', node: 'pve1', vmid: '100', action: 'start' }
const CONN = { id: 'c1', name: 'lab', baseUrl: 'https://pve1:8006', apiToken: 't', insecureDev: false }
const call = (params: Record<string, string> = PARAMS) => callRoute(POST as any, { method: 'POST', params })

/** The tenant's vDC: pool-1 on pve1 and pve2 of c1. */
const iaas = () => ({
  kind: 'iaas',
  vdcScope: {
    connectionIds: new Set(['c1']),
    nodesByConnection: new Map([['c1', new Set(['pve1', 'pve2'])]]),
    poolsByConnection: new Map([['c1', new Set(['pool-1'])]]),
  },
})

const RESOURCES = [
  { vmid: 100, type: 'qemu', node: 'pve1', pool: 'pool-1' },
  { vmid: 200, type: 'qemu', node: 'pve1', pool: 'provider' },
]

const powerCalls = () => m.pveFetch.mock.calls.filter(c => String(c[1]).includes('/status/'))

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.getConnectionById.mockResolvedValue(CONN)
  m.getTenantInfrastructureScope.mockResolvedValue({ kind: 'provider' })
  m.pveFetch.mockImplementation(async (_conn: unknown, path: string) =>
    path === '/cluster/resources?type=vm' ? RESOURCES : 'UPID:pve1:0001:start')
})

describe('POST .../[action]', () => {
  it('runs the action for a provider session', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.checkPermission).toHaveBeenCalledWith('vm.start', 'vm', 'c1:pve1:qemu:100')
    expect(powerCalls()).toHaveLength(1)
    expect(powerCalls()[0][1]).toBe('/nodes/pve1/qemu/100/status/start')
  })

  it('runs the action on a guest inside the tenant vDC pools', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    expect((await call()).status).toBe(200)
    expect(powerCalls()).toHaveLength(1)
  })

  it('refuses a guest outside the tenant vDC pools and sends Proxmox no action', async () => {
    m.getTenantInfrastructureScope.mockResolvedValue(iaas())
    const res = await call({ ...PARAMS, vmid: '200' })
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: 'Guest outside your vDC scope' })
    expect(powerCalls()).toHaveLength(0)
  })

  it('refuses when the vDC scope cannot be verified', async () => {
    m.getTenantInfrastructureScope.mockRejectedValue(new Error('db down'))
    expect((await call()).status).toBe(503)
    expect(powerCalls()).toHaveLength(0)
  })

  it.each([
    ['a vmid that is not digits', { ...PARAMS, vmid: '100;reboot' }],
    ['an unknown guest type', { ...PARAMS, type: 'vm' }],
    ['a node that is not a hostname', { ...PARAMS, node: 'pve1/../pve2' }],
  ])('answers 400 for %s without reaching Proxmox', async (_label, params) => {
    expect((await call(params)).status).toBe(400)
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('rejects an unknown action before any lookup', async () => {
    expect((await call({ ...PARAMS, action: 'destroy' })).status).toBe(400)
    expect(m.checkPermission).not.toHaveBeenCalled()
  })

  it('leaves an RBAC refusal to checkPermission, before the connection is resolved', async () => {
    m.checkPermission.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.getConnectionById).not.toHaveBeenCalled()
    expect(m.pveFetch).not.toHaveBeenCalled()
  })
})
