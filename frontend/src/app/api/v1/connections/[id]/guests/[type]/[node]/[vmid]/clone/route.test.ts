import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

// Capture the after() callbacks so the test can drive the post-clone work.
const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
}))

vi.mock('next/server', async (io) => {
  const actual = await io<typeof import('next/server')>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedBridgesForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveSubnetForBridgeMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const waitForTaskMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CLONE: 'vm.clone' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/vdc/vnets', () => ({
  getAllowedBridgesForTenant: getAllowedBridgesForTenantMock,
  // Use the real regex so the IPAM detection + after() MAC regen behave faithfully.
  parseBridgeFromNet: (s: string) => { const m = String(s || '').match(/bridge=([^,]+)/); return m ? m[1] : null },
  resolveSubnetForBridge: resolveSubnetForBridgeMock,
}))
vi.mock('@/lib/vdc/ipamSync', () => ({ syncIpamForVmConfig: syncIpamForVmConfigMock }))
vi.mock('@/lib/vdc/ipam', () => ({ releaseAllocationsForVm: vi.fn() }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: waitForTaskMock }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }

/** Pull the URLSearchParams sent to the PVE clone POST. */
function cloneCallBody() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST',
  )
  return new URLSearchParams(String(call?.[2]?.body ?? ''))
}

beforeEach(() => {
  h.afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getAllowedBridgesForTenantMock.mockReset().mockResolvedValue(null)
  resolveSubnetForBridgeMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  // Default: config reads return an empty config, clone POST returns a UPID.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:clone:1'
    if (opts?.method === 'PUT') return null
    return {}
  })
})

describe('POST clone — full flag normalization', () => {
  it('sends full=1 (not the string "true") and never sends `unique`', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })

    expect(res.status).toBe(200)
    const body = cloneCallBody()
    expect(body.get('full')).toBe('1')
    expect(body.get('newid')).toBe('101')
    expect(body.has('unique')).toBe(false)
  })

  it('sends full=0 for a linked clone', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 102, full: false } })

    expect(res.status).toBe(200)
    expect(cloneCallBody().get('full')).toBe('0')
  })
})

describe('POST clone — IPAM-managed source', () => {
  it('regenerates the MAC on managed NICs after the clone instead of using `unique`', async () => {
    // Source + clone configs both carry a NIC on the IPAM-managed bridge.
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' }
    })
    resolveSubnetForBridgeMock.mockImplementation(async (_id, bridge) =>
      bridge === 'tenantA' ? { subnetId: 's1' } : null,
    )

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)

    // The clone call itself must not carry `unique`.
    expect(cloneCallBody().has('unique')).toBe(false)

    // Drive the scheduled after() work.
    for (const cb of h.afterCbs) await cb()

    // A PUT to the clone's config strips the inherited MAC so PVE regenerates it.
    const putCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/qemu/101/config') && c[2]?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    expect(new URLSearchParams(String(putCall?.[2]?.body)).get('net0')).toBe('virtio,bridge=tenantA')

    // IPAM allocation is then reconciled against the fresh config.
    expect(syncIpamForVmConfigMock).toHaveBeenCalled()
  })

  it('does not touch MACs when no NIC is on a managed VNet', async () => {
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      return { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr0' }
    })
    // bridge never resolves to a subnet → cloneTouchesIpam stays false

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)

    for (const cb of h.afterCbs) await cb()

    const putCall = pveFetchMock.mock.calls.find((c) => c[2]?.method === 'PUT')
    expect(putCall).toBeUndefined()
  })
})
