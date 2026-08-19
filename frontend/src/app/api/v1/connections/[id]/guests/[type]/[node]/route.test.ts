import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getRequestGuestScopePerimeterMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRequestGuestScopePerimeter: getRequestGuestScopePerimeterMock,
  PERMISSIONS: { VM_CREATE: 'vm.create' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({ resolveVdcForTenant: vi.fn(async () => null), checkVdcQuota: vi.fn() }))
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/vdc/vnets', async (io) => {
  // The verdict logic is what this file exercises, so it runs for real; only
  // the DB-backed allow-list lookup is stubbed.
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    resolveSubnetForBridge: vi.fn(async () => null),
    parseBridgeFromNet: () => null,
  }
})
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve1' }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset().mockResolvedValue('UPID:x')
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
})

describe('POST guests create — MSP VMID range enforcement', () => {
  it('ok: creates the guest and checks the range with the parsed vmid', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
  })

  it('400: rejected by range check, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('tenant range')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('409: already in use, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 409, error: 'VMID 190 is already in use in your infrastructure' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(409)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('enforces the same range check for lxc containers', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: { ...baseParams, type: 'lxc' }, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('POST guests create: flat-scoped pool containment', () => {
  function restrictedTo(pools: string[]) {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: true,
      pools: new Set(pools),
      nodes: new Set(['pve1']),
    })
  }

  function createdBody() {
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()

    return JSON.parse(String(createCall![2].body))
  }

  it('injects the only accessible pool when the body carries none', async () => {
    restrictedTo(['p1'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBe('p1')
  })

  it('403: rejects a pool outside the caller scope, PVE create never called', async () => {
    restrictedTo(['p1'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, pool: 'other' } })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('Resource pool outside your scope')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('400: asks for a pool when several are accessible and none was chosen', async () => {
    restrictedTo(['p1', 'p2'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('A resource pool within your scope is required')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('lets through a pool that belongs to the caller scope', async () => {
    restrictedTo(['p1', 'p2'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, pool: 'p2' } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBe('p2')
  })

  it('leaves the body untouched for a connection-scoped creator', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBeUndefined()
    // No fallback needed, so the perimeter is never resolved.
    expect(getRequestGuestScopePerimeterMock).not.toHaveBeenCalled()
  })
})

describe('POST guests create: vDC network allow-list', () => {
  /** vmbr0 is shared with a 100-199 pool; vnetacme is an SDN vnet. */
  const scoped = () =>
    new Map([
      ['vmbr0', { kind: 'shared' as const, vlanRanges: [{ start: 100, end: 199 }] }],
      ['vnetacme', { kind: 'vnet' as const, vlanRanges: [] }],
    ])

  it('403: a VLAN tag outside the vDC pools never reaches PVE', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr0,tag=250' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain("outside your vDC's VLAN pools")
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: a tag on an SDN vnet is refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vnetacme,tag=150' },
    })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200: a tag inside the vDC pools is accepted', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr0,tag=150' },
    })
    expect(res.status).toBe(200)
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
  })

  it('403: an unknown bridge is still refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr42' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('is not authorized')
  })
})
