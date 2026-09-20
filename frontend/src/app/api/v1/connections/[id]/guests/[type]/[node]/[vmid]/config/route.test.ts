import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const checkPermissionsMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  checkPermissions: checkPermissionsMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: {
    VM_CONFIG: 'vm.config',
    VM_CONFIG_MEDIA: 'vm.config.media',
    VM_CONFIG_NIC_LINK: 'vm.config.nic.link',
    VM_CONFIG_NIC: 'vm.config.nic',
    VM_CONFIG_HARDWARE: 'vm.config.hardware',
    VM_CONFIG_BOOT: 'vm.config.boot',
  },
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
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
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
  checkPermissionsMock.mockReset().mockResolvedValue(null)
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
      body: { net0: 'virtio,bridge=vmbr0,tag=999' },
    })
    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('net0')).toBe('virtio,bridge=vmbr0,tag=999')
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

// #893: the vDC compute policy decides which CPU models a tenant may move to.
describe('PUT config: vDC compute policy', () => {
  const selectedPolicy = {
    vdcId: 'v1',
    poolName: 'p',
    quota: null,
    storagePolicies: [],
    computePolicy: {
      cpuModelMode: 'selected',
      cpuAllowedModels: ['x86-64-v2-AES'],
      cpuDefaultModel: null,
      cpuAdvancedSettings: true,
    },
  }

  it('400: a model outside the allowed set never reaches PVE', async () => {
    resolveVdcForTenantMock.mockResolvedValue(selectedPolicy)
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { cpu: 'host' } })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('"host"')
    expect(configWriteBody()).toBeNull()
  })

  it('200: a model inside the allowed set is written', async () => {
    resolveVdcForTenantMock.mockResolvedValue(selectedPolicy)
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { cpu: 'x86-64-v2-AES' } })

    expect([200, 202]).toContain(res.status)
    expect(configWriteBody()?.get('cpu')).toBe('x86-64-v2-AES')
  })

  it('400: NUMA is refused when the advanced switch is off', async () => {
    resolveVdcForTenantMock.mockResolvedValue({
      ...selectedPolicy,
      computePolicy: { ...selectedPolicy.computePolicy, cpuAdvancedSettings: false },
    })
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { numa: 1 } })

    expect(res.status).toBe(400)
    expect(configWriteBody()).toBeNull()
  })

  it('200: a provider (no vDC) is never constrained', async () => {
    resolveVdcForTenantMock.mockResolvedValue(null)
    const PUT = await loadPut()
    const res = await callRoute(PUT, { method: 'PUT', params: baseParams, body: { cpu: 'host,flags=+aes' } })

    expect([200, 202]).toContain(res.status)
    expect(configWriteBody()?.get('cpu')).toBe('host,flags=+aes')
  })
})


describe('PUT config: existing CD-ROM media authorization', () => {
  function mediaOperator(current: Record<string, unknown> = { sata0: 'none,media=cdrom', scsi0: 'local:vm-100-disk-0' }) {
    pveFetchMock.mockImplementation(async (_c, path: string, opts?: any) => {
      if (path === '/cluster/resources?type=vm') return [{ vmid: 100, type: 'qemu', node: 'pve3', pool: 'pool-a' }]
      return opts?.method === 'POST' || opts?.method === 'PUT' ? null : { ...current, digest: 'generation-1' }
    })
    checkPermissionsMock.mockImplementation(async (permissions: string[]) => permissions.every(p => p === 'vm.config.media')
      ? null : Response.json({ error: 'Hardware permission required' }, { status: 403 }))
  }
  it('mounts an ISO on an existing empty SATA optical drive and binds the PVE digest', async () => {
    mediaOperator()
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'local:iso/debian.iso,media=cdrom' } })
    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('sata0')).toBe('local:iso/debian.iso,media=cdrom')
    expect(configWriteBody()?.get('digest')).toBe('generation-1')
  })
  it('ejects a mounted ISO without deleting the drive', async () => {
    mediaOperator({ sata0: 'local:iso/debian.iso,media=cdrom,size=1G' })
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'none,media=cdrom' } })
    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('sata0')).toBe('none,media=cdrom')
    expect(configWriteBody()?.has('delete')).toBe(false)
  })
  for (const body of [
    { sata1: 'local:iso/debian.iso,media=cdrom' },
    { scsi0: 'local:iso/debian.iso,media=cdrom' },
    { sata0: 'local:vm-200-disk-0,media=cdrom' },
    { sata0: 'local:32,media=cdrom' },
    { sata0: 'local:iso/debian.iso,media=cdrom,cache=writeback' },
    { sata0: 'local:iso/debian.iso,media=cdrom', cores: 16 },
    { sata0: 'local:iso/debian.iso,media=cdrom', memory: 16384 },
    { delete: 'sata0' }, { revert: 'sata0' },
  ]) {
    it(`refuses forged hardware changes ${JSON.stringify(body)}`, async () => {
      mediaOperator()
      const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body })
      expect(res.status).toBe(403)
      expect(configWriteBody()).toBeNull()
    })
  }
  it('leaves data disk edits unbound from the PVE digest', async () => {
    mediaOperator({ sata0: 'none,media=cdrom', scsi0: 'local:vm-100-disk-0,size=32G' })
    checkPermissionsMock.mockImplementation(async () => null)
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { scsi0: 'local:vm-100-disk-0,size=32G,cache=writeback' } })
    expect(res.status).toBe(200)
    expect(configWriteBody()?.has('digest')).toBe(false)
  })
  it('binds the digest when a data slot is turned into an optical drive', async () => {
    mediaOperator({ scsi0: 'local:vm-100-disk-0,size=32G' })
    checkPermissionsMock.mockImplementation(async () => null)
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata1: 'none,media=cdrom' } })
    expect(res.status).toBe(200)
    expect(configWriteBody()?.get('digest')).toBe('generation-1')
  })
  it('keeps a hardware grant sufficient for existing media changes', async () => {
    mediaOperator()
    checkPermissionsMock.mockImplementation(async (permissions: string[]) => permissions.every(p => p === 'vm.config.hardware')
      ? null : Response.json({ error: 'Media permission absent' }, { status: 403 }))
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'local:iso/debian.iso,media=cdrom' } })
    expect(res.status).toBe(200)
  })
  it('does not bypass vDC storage scope with a media grant', async () => {
    mediaOperator()
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(['pve3'])]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-a'])]]),
      storagesByConnection: new Map([['conn-1', new Set(['local'])]]),
      storagePoliciesByConnection: new Map(),
    } })
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'foreign:iso/debian.iso,media=cdrom' } })
    expect(res.status).toBe(403)
    expect(configWriteBody()).toBeNull()
  })
  it('rejects a stale client digest and preserves a matching one', async () => {
    mediaOperator()
    const stale = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'none,media=cdrom', digest: 'stale-generation' } })
    expect(stale.status).toBe(409)
    expect(configWriteBody()).toBeNull()
    const current = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { sata0: 'none,media=cdrom', digest: 'generation-1' } })
    expect(current.status).toBe(200)
    expect(configWriteBody()?.get('digest')).toBe('generation-1')
  })
})


describe('GET/PUT config: tenant vDC guest containment', () => {
  function tenantScope(nodes = ['pve3']) {
    return { kind: 'iaas', vdcScope: {
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(nodes)]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-a'])]]),
      storagesByConnection: new Map([['conn-1', new Set(['local'])]]),
      storagePoliciesByConnection: new Map(),
    } }
  }
  function inventory(resources: unknown) {
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (path === '/cluster/resources?type=vm') {
        if (resources instanceof Error) throw resources
        return resources
      }
      if (opts?.method === 'POST' || opts?.method === 'PUT') return null
      return { sata0: 'none,media=cdrom', digest: 'generation-1' }
    })
  }
  const mine = { vmid: 100, type: 'qemu', node: 'pve3', pool: 'pool-a' }
  async function request(method: 'GET' | 'PUT') {
    const routes = await import('./route')
    return callRoute(routes[method] as Parameters<typeof callRoute>[0], {
      method, params: baseParams, ...(method === 'PUT' ? { body: { sata0: 'local:iso/debian.iso,media=cdrom' } } : {}),
    })
  }
  for (const method of ['GET', 'PUT'] as const) {
    it(`${method}: allows the tenant's pool using the full authorization union`, async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope())
      inventory([mine])
      expect((await request(method)).status).toBe(200)
      expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-1', { ignoreVdcContext: true })
    })
    for (const [label, resources] of [
      ['another tenant pool', [{ ...mine, pool: 'pool-b' }]],
      ['no pool', [{ ...mine, pool: '' }]],
      ['foreign node on the same connection', [{ ...mine, node: 'pve9' }]],
      ['wrong guest type', [{ ...mine, type: 'lxc' }]],
      ['unknown VM', [{ ...mine, vmid: 101 }]],
    ] as const) {
      it(`${method}: refuses ${label} before reading or writing config`, async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope())
        inventory(resources)
        expect((await request(method)).status).toBe(403)
        expect(pveFetchMock.mock.calls.some(c => String(c[1]).includes('/config'))).toBe(false)
      })
    }
    for (const resources of [new Error('PVE unavailable'), { data: 'unexpected' }]) {
      it(`${method}: fails closed when live ownership cannot be determined`, async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope())
        inventory(resources)
        expect((await request(method)).status).toBe(503)
        expect(pveFetchMock.mock.calls.some(c => String(c[1]).includes('/config'))).toBe(false)
      })
    }
    it(`${method}: rejects an unauthorized requested node before cluster access`, async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope(['pve9']))
      inventory([{ ...mine, node: 'pve9' }])
      expect((await request(method)).status).toBe(403)
      expect(pveFetchMock).not.toHaveBeenCalled()
    })
    it(`${method}: keeps provider/MSP access free of vDC pool masking`, async () => {
      for (const scope of [{ kind: 'provider' }, { kind: 'msp', connectionIds: new Set(['conn-1']) }]) {
        getTenantInfrastructureScopeMock.mockResolvedValue(scope)
        inventory([])
        expect((await request(method)).status).toBe(200)
        expect(pveFetchMock.mock.calls.some(c => c[1] === '/cluster/resources?type=vm')).toBe(false)
      }
    })
  }
  it('GET: rechecks ownership on the authorized destination after a migration', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope(['pve3', 'pve4']))
    pveFetchMock.mockImplementation(async (_conn, path: string) => {
      if (path === '/cluster/resources?type=vm') return [{ ...mine, node: 'pve4' }]
      if (path.startsWith('/nodes/pve3/')) throw new Error('Configuration file does not exist')
      return { sata0: 'none,media=cdrom' }
    })
    const res = await request('GET')
    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).startsWith('/nodes/pve4/'))).toBe(true)
  })
  it('GET: refuses a VM moved outside the tenant pool before the fallback config read', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(tenantScope(['pve3', 'pve4']))
    let lookups = 0
    pveFetchMock.mockImplementation(async (_conn, path: string) => {
      if (path === '/cluster/resources?type=vm') {
        lookups++
        return [{ ...mine, node: 'pve4', pool: lookups < 3 ? 'pool-a' : 'pool-b' }]
      }
      if (path.startsWith('/nodes/pve3/')) throw new Error('Configuration file does not exist')
      return { sata0: 'none,media=cdrom' }
    })
    expect((await request('GET')).status).toBe(403)
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).startsWith('/nodes/pve4/'))).toBe(false)
  })

})


describe('PUT config: tenant NIC identity authorization', () => {
  const original = 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0,tag=100,trunks=110;120'
  function setConfig(running = original) {
    pveFetchMock.mockImplementation(async (_c, path: string, opts?: any) => {
      if (opts?.method === 'POST' || opts?.method === 'PUT') return null
      return { net0: path.includes('current=1') ? running : original, digest: 'generation-1' }
    })
    checkPermissionsMock.mockImplementation(async (permissions: string[]) => permissions.some(p => ['vm.config.nic.mac', 'vm.config.nic.vlan'].includes(p))
      ? Response.json({ error: 'Explicit NIC permission required' }, { status: 403 }) : null)
  }
  for (const [label, body] of [
    ['MAC change', { net0: original.replace('EE:01', 'EE:02') }],
    ['tag change', { net0: original.replace('tag=100', 'tag=101') }],
    ['trunk change', { net0: original.replace('110;120', '110;130') }],
    ['omitted identity', { net0: 'virtio,bridge=vmbr0' }],
    ['new NIC explicit identity', { net1: original }],
  ] as const) {
    it(`refuses ${label} before PVE writes`, async () => {
      setConfig()
      const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body })
      expect(res.status).toBe(403)
      expect(configWriteBody()).toBeNull()
    })
  }
  it('preserves link-only rights and binds the mutation to the PVE digest', async () => {
    setConfig()
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { net0: original + ',link_down=1' } })
    expect(res.status).toBe(200)
    expect(checkPermissionsMock).toHaveBeenCalledWith(['vm.config.nic.link'], 'vm', 'res')
    expect(configWriteBody()?.get('digest')).toBe('generation-1')
  })
  it('refuses a revert that changes protected running values', async () => {
    setConfig(original.replace('EE:01', 'EE:02'))
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { revert: 'net0' } })
    expect(res.status).toBe(403)
    expect(configWriteBody()).toBeNull()
  })
  it('rejects duplicate protected properties with a 400', async () => {
    setConfig()
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { net0: original + ',tag=101' } })
    expect(res.status).toBe(400)
    expect(configWriteBody()).toBeNull()
  })
  it('accepts explicit rights without weakening the network allow-list', async () => {
    setConfig()
    checkPermissionsMock.mockResolvedValue(null)
    getAllowedNetworksForTenantMock.mockResolvedValue(new Map([['vmbr0', { kind: 'shared', vlanRanges: [{ start: 100, end: 199 }] }]]))
    const res = await callRoute(await loadPut(), { method: 'PUT', params: baseParams, body: { net0: original.replace('tag=100', 'tag=900') } })
    expect(res.status).toBe(403)
    expect(configWriteBody()).toBeNull()
  })
})
