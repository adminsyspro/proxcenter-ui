import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CONFIG: 'vm.config' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
// Spread the real module: the config write path also reads
// PVE_DEFAULT_TIMEOUT_MS from it, and a factory listing only pveFetch breaks
// as soon as another export is imported.
vi.mock('@/lib/proxmox/client', async io => {
  const actual = await io<typeof import('@/lib/proxmox/client')>()

  return { ...actual, pveFetch: pveFetchMock }
})
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
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

/**
 * Pull the URLSearchParams sent to the PVE config write. qemu goes through
 * PVE's asynchronous handler (POST), LXC has none and keeps PUT (#743).
 */
function configWriteBody() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/config') && (c[2]?.method === 'POST' || c[2]?.method === 'PUT'),
  )
  return call ? new URLSearchParams(String(call?.[2]?.body ?? '')) : null
}

/** The method PVE was asked to write the config with, or null if it never was. */
function configWriteMethod() {
  const call = pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/config') && (c[2]?.method === 'POST' || c[2]?.method === 'PUT'),
  )
  return call ? String(call[2].method) : null
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  // This suite is about the net0 allow-list; the disk-drive guard (Task 8) is
  // exercised separately in configRouteDrives.test.ts, so default to
  // 'provider' here (enforceTenantDrives short-circuits to null, unchanged).
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: config GET reads return an empty config, the config write
  // succeeds with nothing to apply (so no task to follow).
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST' || opts?.method === 'PUT') return null
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
    expect(configWriteBody()?.get('net0')).toBe('virtio,bridge=vmbr0,tag=150')
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
    expect(configWriteBody()).toBeNull()
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
    expect(configWriteBody()).toBeNull()
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
    expect(configWriteBody()?.get('net0')).toBe('virtio,bridge=vmbr0,tag=9999')
  })
})

describe('PUT config: a slow apply is no longer reported as a failed save (#743)', () => {
  const UPID = 'UPID:pve3:0000ABCD:00112233:66C0FFEE:qmconfig:100:root@pam:'

  /**
   * PVE answers the config write with a UPID, then the task status endpoint
   * answers whatever `taskStatus` says.
   */
  function pveWithTask(taskStatus: any) {
    pveFetchMock.mockReset().mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST' || opts?.method === 'PUT') return UPID
      if (String(path).includes('/tasks/')) return taskStatus
      return {}
    })
  }

  it("writes a qemu config through PVE's asynchronous handler", async () => {
    // PUT is PVE's synchronous handler and its own description tells clients
    // to prefer POST for anything involving hotplug. A memory unplug sleeps
    // 3s per DIMM, far past our 8s request budget.
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

    expect(res.status).toBe(200)
    expect(configWriteMethod()).toBe('POST')
    expect(configWriteBody()?.get('memory')).toBe('4096')
    expect(configWriteBody()?.get('background_delay')).toBe('3')
  })

  it('keeps the synchronous handler for an LXC guest, which has no asynchronous one', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { ...baseParams, type: 'lxc' },
      body: { memory: 2048 },
    })

    expect(res.status).toBe(200)
    expect(configWriteMethod()).toBe('PUT')
  })

  it('follows the task and answers 200 once it ends on OK', async () => {
    pveWithTask({ status: 'stopped', exitstatus: 'OK' })

    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).includes(`/tasks/${encodeURIComponent(UPID)}/status`))).toBe(true)
  })

  it('answers 202 with the upid when the task outlives the request budget', async () => {
    // THE fix for #743: the change IS being applied, so the caller gets the
    // task to keep following instead of an error on a save that worked.
    pveWithTask({ status: 'running' })

    const PUT = await loadPut()

    vi.useFakeTimers()
    try {
      const pending = callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

      await vi.advanceTimersByTimeAsync(50_000)

      const res = await pending

      expect(res.status).toBe(202)
      expect(await res.json()).toMatchObject({ success: true, pending: true, upid: UPID, node: 'pve3' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('500s and rolls the IPAM back when the task itself failed', async () => {
    // The write reached PVE but its worker died, so the DB must not keep the
    // allocation it made for a config that never changed.
    const rollback = vi.fn()

    syncIpamForVmConfigMock.mockResolvedValue({ bodyOverrides: {}, rollback })
    pveWithTask({ status: 'stopped', exitstatus: 'error unplug memory module' })

    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

    expect(res.status).toBe(500)
    expect((await res.json() as { error: string }).error).toContain('error unplug memory module')
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('keeps the segments of a memory property string it does not edit', async () => {
    // PVE's `memory` key is a property string whose default key is the online
    // amount. Sending a bare integer would drop everything else it carried.
    pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST' || opts?.method === 'PUT') return null
      return { memory: 'current=8192,max=32768' }
    })

    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('memory')).toBe('current=4096,max=32768')
  })

  it('sends a plain integer when there is nothing to preserve', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { memory: 4096 } })

    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('memory')).toBe('4096')
  })
})

describe('PUT config: keys the Options tab edits (#566)', () => {
  it('forwards hostname, features and startup for a container', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { ...baseParams, type: 'lxc' },
      body: { hostname: 'web-01', features: 'nesting=1,keyctl=1', startup: 'order=2' },
    })

    expect(res.status).toBe(200)
    const body = configWriteBody()
    expect(body?.get('hostname')).toBe('web-01')
    expect(body?.get('features')).toBe('nesting=1,keyctl=1')
    expect(body?.get('startup')).toBe('order=2')
  })

  it('clears every container feature through delete=features', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { ...baseParams, type: 'lxc' },
      body: { delete: 'features' },
    })

    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('delete')).toBe('features')
  })

  it('rejects the QEMU-only name key for a container instead of forwarding it', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { ...baseParams, type: 'lxc' },
      body: { name: 'web-01' },
    })

    expect(res.status).toBe(400)
    expect(configWriteBody()).toBeNull()
  })

  it('forwards the startup order for a VM', async () => {
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { startup: 'order=1,up=30' } })

    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('startup')).toBe('order=1,up=30')
  })
})
