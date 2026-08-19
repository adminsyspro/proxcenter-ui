import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CONFIG: 'vm.config' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/vdc/vnets', async (io) => {
  // Real verdict logic, so the tag/trunks guard behaves faithfully; only the
  // DB-backed allow-list lookup is stubbed.
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
  }
})
vi.mock('@/lib/vdc/ipamSync', () => ({
  syncIpamForVmConfig: syncIpamForVmConfigMock,
  IpamHintUnavailableError: class IpamHintUnavailableError extends Error {},
  IpamExhaustedError: class IpamExhaustedError extends Error {},
}))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPut() {
  const mod = await import('./route')
  return mod.PUT as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }

/** Pull the URLSearchParams sent to the PVE config PUT. */
function configPutBody() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/config') && c[2]?.method === 'PUT',
  )
  return call ? new URLSearchParams(String(call?.[2]?.body ?? '')) : null
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  // Default: config GET reads return an empty config, the config PUT succeeds.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'PUT') return { data: 'ok' }
    return {}
  })
})

describe('PUT config: vDC network allow-list guard', () => {
  /** vmbr0 is shared with a 100-199 pool; vnetacme is an SDN vnet. */
  const scoped = () =>
    new Map([
      ['vmbr0', { kind: 'shared' as const, vlanRanges: [{ start: 100, end: 199 }] }],
      ['vnetacme', { kind: 'vnet' as const, vlanRanges: [] }],
    ])

  it('200: a restricted tenant tagging inside the pool on a shared bridge reaches PVE', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { net0: 'virtio,bridge=vmbr0,tag=150' },
    })
    expect(res.status).toBe(200)
    expect(configPutBody()?.get('net0')).toBe('virtio,bridge=vmbr0,tag=150')
  })

  it('403: a tag outside the vDC pools never reaches the PVE config PUT', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { net0: 'virtio,bridge=vmbr0,tag=250' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("outside your vDC's VLAN pools")
    expect(configPutBody()).toBeNull()
  })

  it('403: a tag on an SDN vnet is refused (the vnet already carries its own tag)', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { net0: 'virtio,bridge=vnetacme,tag=10' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('not allowed on SDN network')
    expect(configPutBody()).toBeNull()
  })

  it('200: an unrestricted tenant (null allow-list) passes unchanged', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(null)
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: baseParams,
      body: { net0: 'virtio,bridge=vmbr0,tag=9999' },
    })
    expect(res.status).toBe(200)
    expect(configPutBody()?.get('net0')).toBe('virtio,bridge=vmbr0,tag=9999')
  })
})
