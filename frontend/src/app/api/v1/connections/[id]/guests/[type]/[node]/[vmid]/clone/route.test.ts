import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
// The vDC guest guard (lib/vdc/guestGuard.ts) has its own tests: pass-through
// here, as for a provider session.
vi.mock('@/lib/vdc/guestGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vdc/guestGuard')>()),
  guardSessionGuest: async () => null,
}))
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from '@/__tests__/setup/route-test'
import { pendingVdcGpus, resetVdcPending } from '@/lib/gpu/vdcPending'

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
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolveSubnetForBridgeMock = vi.fn<(...args: any[]) => Promise<any>>()
const syncIpamForVmConfigMock = vi.fn<(...args: any[]) => Promise<any>>()
const { waitForTaskMock, waitForTaskStoppedMock } = vi.hoisted(() => ({
  waitForTaskMock: vi.fn<(...args: any[]) => Promise<any>>(),
  waitForTaskStoppedMock: vi.fn<(...args: any[]) => Promise<any>>(),
}))
const tenantAddsGpuMock = vi.fn<(...args: any[]) => Promise<'adds' | 'none' | 'unknown'>>()
const cloneContingentCheckMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CLONE: 'vm.clone', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/cache/guestSetRefresh', () => ({ refreshCachedGuests: vi.fn() }))
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1', requireProviderTenant: () => requireProviderTenantMock() }))
vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: resolveVdcForTenantMock,
  checkVdcQuota: checkVdcQuotaMock,
}))
vi.mock('@/lib/vdc/vnets', async (io) => {
  // Real parser + real verdict logic, so the IPAM detection, the after() MAC
  // regen and the tag/trunks guard all behave faithfully; only the DB-backed
  // allow-list lookups are stubbed.
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    parseBridgeFromNet: actual.parseBridgeFromNet,
    resolveSubnetForBridge: resolveSubnetForBridgeMock,
  }
})
vi.mock('@/lib/vdc/ipamSync', () => ({ syncIpamForVmConfig: syncIpamForVmConfigMock }))
vi.mock('@/lib/vdc/ipam', () => ({ releaseAllocationsForVm: vi.fn() }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: waitForTaskMock, waitForTaskStopped: waitForTaskStoppedMock }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
const { restampGuestDrivesMock } = vi.hoisted(() => ({ restampGuestDrivesMock: vi.fn(async () => ({ stamped: [] })) }))
vi.mock('@/lib/vdc/driveGuard', () => ({ restampGuestDrives: restampGuestDrivesMock }))
vi.mock('@/lib/gpu/vdcGuard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcGuard')>('@/lib/gpu/vdcGuard')
  return { tenantAddsGpu: tenantAddsGpuMock, cloneContingentCheck: cloneContingentCheckMock, contingentRefusal: actual.contingentRefusal }
})
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

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
  tenantAddsGpuMock.mockReset().mockResolvedValue('none')
  cloneContingentCheckMock.mockReset().mockResolvedValue({ ok: true, demand: [] })
  resetVdcPending()
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  resolveSubnetForBridgeMock.mockReset().mockResolvedValue(null)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  waitForTaskStoppedMock.mockReset().mockResolvedValue({ stopped: true, exitstatus: 'OK' })
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: config reads return an empty config, clone POST returns a UPID.
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:clone:1'
    if (opts?.method === 'PUT') return null
    return {}
  })
})

describe('POST clone — MSP VMID range enforcement', () => {
  it('rejects a newid outside the tenant range and never calls PVE clone', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(400)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 101)
    const cloneCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST',
    )
    expect(cloneCall).toBeUndefined()
  })
})

describe('POST clone: vDC quota metering (#1293)', () => {
  it('meters the source RAM as a number although PVE sends `memory` as a string', async () => {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'vdc-pool', quota: { maxRamMb: 65536 }, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:pve3:1:clone'
      if (path === '/nodes/pve3/qemu/100/config') return { memory: '2048', cores: 2, template: 1 }
      return {}
    })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101 } })
    expect(res.status).toBe(200)
    const op = checkVdcQuotaMock.mock.calls[0][3]
    expect(op.addRamMb).toBe(2048)
    expect(op.addVcpus).toBe(2)
  })

  it('reads a `current=` memory property string', async () => {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'vdc-pool', quota: { maxRamMb: 65536 }, storagePolicies: [] })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:pve3:1:clone'
      if (path === '/nodes/pve3/qemu/100/config') return { memory: 'current=4096', template: 1 }
      return {}
    })
    const POST = await loadPost()
    await callRoute(POST, { params: baseParams, body: { newid: 101 } })
    expect(checkVdcQuotaMock.mock.calls[0][3].addRamMb).toBe(4096)
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

  // roadmap#192: the clone patches the cached inventories with one read of
  // its connection, never a global invalidation.
  it('refreshes the cached guests of the connection, naming the new vmid', async () => {
    const { refreshCachedGuests } = await import('@/lib/cache/guestSetRefresh')
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(200)
    expect(refreshCachedGuests).toHaveBeenCalledWith('conn-1', { id: 'conn-1' }, { type: 'qemu', vmid: 101 })
  })

  it('sends full=0 for a linked clone', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 102, full: false } })

    expect(res.status).toBe(200)
    expect(cloneCallBody().get('full')).toBe('0')
  })
})

describe('POST clone: container (#181)', () => {
  it('names the copy with `hostname` and drops the image format pct clone does not take', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: { ...baseParams, type: 'lxc' }, body: { newid: 120, name: 'ct-copy', storage: 'ceph', format: 'qcow2', full: true } })

    expect(res.status).toBe(200)
    const body = cloneCallBody()
    expect(body.get('hostname')).toBe('ct-copy')
    expect(body.has('name')).toBe(false)
    expect(body.has('format')).toBe(false)
  })

  it('checks the rootfs and mount points of a container kept on its storages', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/nodes/pve3/lxc/100/config') return { rootfs: 'ZFS-Pool:subvol-100-disk-0,size=8G' }
      if (path === '/storage/ZFS-Pool') return { type: 'zfspool' }
      return {}
    })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: { ...baseParams, type: 'lxc' }, body: { newid: 120, name: 'ct-copy', full: true, ha: true } })

    expect(res.status).toBe(400)
    expect(cloneCallBody().get('newid')).toBeNull()
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

  it('waits on the source node and rewrites the clone on the target node (#1293)', async () => {
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      if (opts?.method === 'PUT') return null
      return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' }
    })
    resolveSubnetForBridgeMock.mockImplementation(async (_id, bridge) =>
      bridge === 'tenantA' ? { subnetId: 's1' } : null,
    )

    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true, target: 'pve2' } })
    expect(res.status).toBe(200)
    for (const cb of h.afterCbs) await cb()

    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:clone:1')
    const putCall = pveFetchMock.mock.calls.find((c) => c[2]?.method === 'PUT')
    expect(putCall?.[1]).toBe('/nodes/pve2/qemu/101/config')
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

describe('POST clone: vDC network allow-list', () => {
  /** vmbr0 is shared with a 100-199 pool; vnetacme is an SDN vnet. */
  const scoped = () =>
    new Map([
      ['vmbr0', { kind: 'shared' as const, vlanRanges: [{ start: 100, end: 199 }] }],
      ['vnetacme', { kind: 'vnet' as const, vlanRanges: [] }],
    ])

  it('403: a VLAN tag outside the vDC pools never reaches the PVE clone', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, net0: 'virtio,bridge=vmbr0,tag=250' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("outside your vDC's VLAN pools")
    const cloneCall = pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST',
    )
    expect(cloneCall).toBeUndefined()
  })

  it('403: trunks reaching outside the vDC pools is refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, net0: 'virtio,bridge=vmbr0,trunks=150;500' },
    })
    expect(res.status).toBe(403)
  })

  it('200: a tag inside the vDC pools is accepted', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, net0: 'virtio,bridge=vmbr0,tag=150' },
    })
    expect(res.status).toBe(200)
    expect(cloneCallBody().get('newid')).toBe('101')
  })

  it('403: an unknown bridge is still refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { newid: 101, full: true, net0: 'virtio,bridge=vmbr42' },
    })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('is not authorized')
  })
})

describe('POST clone — read-only ISO library target (#894)', () => {
  const libraryScope = {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(['ceph-nvme', 'isolib'])]]),
      writableStoragesByConnection: new Map([['conn-1', new Set(['ceph-nvme'])]]),
      isoLibrariesByConnection: new Map([['conn-1', new Set(['isolib'])]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map()]]),
    },
  }

  it('403: cloning onto a library storage is refused before any PVE call', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(libraryScope)
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true, storage: 'isolib' } })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/read-only ISO library/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a writable target next to the library passes the storage check', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(libraryScope)
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true, storage: 'ceph-nvme' } })
    expect(res.status).toBe(200)
  })
})

describe('POST clone — cluster outside the license (roadmap#58)', () => {
  it('answers 403 with its code when the clone write is refused, and waits for no task', async () => {
    const { PveLicenseExcludedError } = await import('@/lib/license/exclusions')
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') throw new PveLicenseExcludedError('conn-1')
      return {}
    })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 101, full: true } })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })
    expect(waitForTaskMock).not.toHaveBeenCalled()
  })
})

/** Run the captured after() callbacks one after the other. */
function runAfterCbs(): Promise<void> {
  return h.afterCbs.reduce<Promise<void>>((prev, cb) => prev.then(cb), Promise.resolve())
}

describe('POST clone — high availability on the clone (#181)', () => {
  const haCalls = () => pveFetchMock.mock.calls.filter(([, path, opts]: any) => path === '/cluster/ha/resources' && opts?.method === 'POST')
  /** Source on local `Dir-Images`, `ceph` shared. */
  function stubStorages() {
    pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
      if (path === '/storage/ceph') return { type: 'rbd' }
      if (path === '/storage/Dir-Images') return { type: 'dir' }
      if (path === '/nodes/pve3/qemu/100/config') return { sata0: 'Dir-Images:100/base-100-disk-1.qcow2,size=60G', efidisk0: 'Dir-Images:100/base-100-disk-0.qcow2' }
      if (opts?.method === 'POST') return path.endsWith('/clone') ? 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:' : null
      return {}
    })
  }

  it('never forwards `ha` to the PVE clone call, and registers the clone once the task is done', async () => {
    stubStorages()
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, full: true, storage: 'ceph', target: 'pve2', ha: true } })
    expect(res.status).toBe(200)
    expect(cloneCallBody().has('ha')).toBe(false)
    expect(haCalls()).toHaveLength(0)

    await runAfterCbs()

    // The task runs on the source node (pve3) even for a clone to pve2.
    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:', { acceptWarnings: true })
    expect(haCalls()).toHaveLength(1)
    expect(Object.fromEntries(new URLSearchParams(haCalls()[0][2].body))).toEqual({ sid: 'vm:150', state: 'started' })
  })

  it('refuses HA without node.manage on the connection', async () => {
    checkPermissionMock.mockImplementation(async (perm: string) => (perm === 'node.manage' ? new Response('no', { status: 403 }) : null))
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, storage: 'ceph', ha: true } })
    expect(res.status).toBe(403)
    expect(cloneCallBody().get('newid')).toBeNull()
  })

  it('refuses HA outside the provider tenant', async () => {
    requireProviderTenantMock.mockResolvedValue(new Response('provider only', { status: 403 }))
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, storage: 'ceph', ha: true } })
    expect(res.status).toBe(403)
  })

  it('refuses HA on a local target storage before cloning', async () => {
    stubStorages()
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, storage: 'Dir-Images', ha: true } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/shared storage/)
    expect(cloneCallBody().get('newid')).toBeNull()
  })

  it('without a target storage, checks the storages of the source disks (a linked clone keeps them)', async () => {
    stubStorages()
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, full: false, ha: true } })
    expect(res.status).toBe(400)
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve3/qemu/100/config')
  })

  it('a failed registration is logged, the clone stays', async () => {
    stubStorages()
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (conn: any, path: string, opts?: any) => {
      if (path === '/cluster/ha/resources') throw new Error('already defined')
      return base(conn, path, opts)
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, storage: 'ceph', ha: true } })
    expect(res.status).toBe(200)
    await runAfterCbs()
    expect(spy.mock.calls.some(c => /\[clone-ha\].*already defined/.test(String(c[0])))).toBe(true)
    spy.mockRestore()
  })

  it('without ha, nothing is checked or registered', async () => {
    const POST = await loadPost()
    await callRoute(POST, { params: baseParams, body: { newid: 150, storage: 'Dir-Images' } })
    await runAfterCbs()
    expect(haCalls()).toHaveLength(0)
    expect(checkPermissionMock).not.toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
  })
})

describe('POST clone: storage-tier QoS restamp on another node (#1293)', () => {
  it('waits on the source node and restamps the clone on the target node', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { storagePoliciesByConnection: new Map([['conn-1', new Map([['ceph', { iops_rd: 100 }]])]]) },
    })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { newid: 150, full: true, target: 'pve2' } })
    expect(res.status).toBe(200)
    await runAfterCbs()

    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:clone:1')
    expect(restampGuestDrivesMock).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/nodes/pve2/qemu/150/config' }))
  })
})

describe('POST clone: the vDC GPU contingent (#672)', () => {
  const vdc = { vdcId: 'v1', poolName: 'vdc-a', quota: null, storagePolicies: [] }
  const withGpu = () => pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:clone:1'
    return { cores: 2, memory: 4096, hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665', template: 1 }
  })
  const cloned = () => pveFetchMock.mock.calls.some(c => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST')

  it('409 quota_exhausted: the line of the source GPU is full', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    withGpu()
    tenantAddsGpuMock.mockResolvedValue('adds')
    cloneContingentCheckMock.mockResolvedValue({ ok: false, code: 'quota_exhausted', used: 2, count: 2 })
    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: false } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'quota_exhausted', used: 2, count: 2 })
    expect(tenantAddsGpuMock).toHaveBeenCalledWith('conn-1', 'pve3', { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' }, {})
    expect(cloneContingentCheckMock).toHaveBeenCalledWith('v1', 'conn-1', 'vdc-a', 'pve3', { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' })
    expect(cloned()).toBe(false)
  })

  it('503 gpu_check_unavailable: the contingent cannot be checked now', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    withGpu()
    tenantAddsGpuMock.mockResolvedValue('adds')
    cloneContingentCheckMock.mockResolvedValue({ ok: false, code: 'gpu_check_unavailable' })
    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: false } })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'gpu_check_unavailable' })
    expect(cloned()).toBe(false)
  })

  it('a GPU the source releases while running still goes with the clone: it is judged', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    tenantAddsGpuMock.mockResolvedValue('adds')
    cloneContingentCheckMock.mockResolvedValue({ ok: false, code: 'quota_exhausted', used: 1, count: 1 })
    pveFetchMock.mockImplementation(async (_conn, path, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:clone:1'
      // PVE clones the current config: the pending delete does not reach the clone.
      if (String(path).endsWith('/qemu/100/pending')) return [{ key: 'cores', value: 2 }, { key: 'hostpci0', value: 'mapping=gpu-w,pcie=1', delete: 1 }]
      return { cores: 2, memory: 4096 }
    })
    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: true } })
    expect(res.status).toBe(409)
    expect(tenantAddsGpuMock).toHaveBeenCalledWith('conn-1', 'pve3', { hostpci0: 'mapping=gpu-w,pcie=1' }, {})
    expect(cloneContingentCheckMock).toHaveBeenCalledWith('v1', 'conn-1', 'vdc-a', 'pve3', { hostpci0: 'mapping=gpu-w,pcie=1' })
    expect(cloned()).toBe(false)
  })

  it('a source the cached collection cannot judge goes to the fresh contingent check', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    withGpu()
    tenantAddsGpuMock.mockResolvedValue('unknown')
    cloneContingentCheckMock.mockResolvedValue({ ok: false, code: 'gpu_check_unavailable' })
    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: false } })
    expect(res.status).toBe(503)
    expect(cloneContingentCheckMock).toHaveBeenCalled()
    expect(cloned()).toBe(false)
  })

  it('the clone goes through when the line has room', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    withGpu()
    tenantAddsGpuMock.mockResolvedValue('adds')
    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: false } })
    expect(res.status).toBe(200)
    expect(cloned()).toBe(true)
  })

  it('two clones on the last slot: one goes through, the other is refused, the slot held until the task ends', async () => {
    const q12 = { kind: 'vgpu', modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q' }
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    tenantAddsGpuMock.mockResolvedValue('adds')
    // One slot left: the check sees the clones PVE already accepted.
    cloneContingentCheckMock.mockImplementation(async (vdcId: string) => {
      await new Promise(r => setTimeout(r, 5))
      return pendingVdcGpus(vdcId).length > 0 ? { ok: false, code: 'quota_exhausted', used: 2, count: 2 } : { ok: true, demand: [q12] }
    })
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') {
        await new Promise(r => setTimeout(r, 10))
        return 'UPID:clone:1'
      }
      return { cores: 2, memory: 4096, hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665', template: 1 }
    })
    let finish!: () => void
    waitForTaskStoppedMock.mockImplementation(() => new Promise(r => { finish = () => r({ stopped: true, exitstatus: 'OK' }) }))

    const POST = await loadPost()
    const [a, b] = await Promise.all([
      callRoute(POST, { params: baseParams, body: { newid: 101, full: false } }),
      callRoute(POST, { params: baseParams, body: { newid: 102, full: false } }),
    ])
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409])
    const refused = a.status === 409 ? a : b
    expect(await refused.json()).toEqual({ error: 'quota_exhausted', used: 2, count: 2 })
    expect(pveFetchMock.mock.calls.filter(c => String(c[1]).endsWith('/clone') && c[2]?.method === 'POST')).toHaveLength(1)
    expect(pendingVdcGpus('v1')).toHaveLength(1)

    const done = runAfterCbs()
    await new Promise(r => setTimeout(r, 0))
    finish()
    await done
    expect(pendingVdcGpus('v1')).toEqual([])
  })

  it('a clone to another node keeps its vGPU reserved until the source node reports the task stopped', async () => {
    const q12 = { kind: 'vgpu', modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q' }
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    tenantAddsGpuMock.mockResolvedValue('adds')
    cloneContingentCheckMock.mockResolvedValue({ ok: true, demand: [q12] })
    pveFetchMock.mockImplementation(async (_conn, _path, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:'
      return { cores: 2, memory: 4096, hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' }
    })
    // Timeout or polls that never saw the end: the reservation stays (its TTL ends it).
    waitForTaskStoppedMock.mockResolvedValue({ stopped: false })
    expect((await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: true, target: 'pve9' } })).status).toBe(200)
    await runAfterCbs()
    expect(waitForTaskStoppedMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:', expect.objectContaining({ timeoutMs: expect.any(Number) }))
    expect(pendingVdcGpus('v1')).toHaveLength(1)

    h.afterCbs.length = 0
    resetVdcPending()
    waitForTaskStoppedMock.mockResolvedValue({ stopped: true, exitstatus: 'clone failed: no space left' })
    expect((await callRoute(await loadPost(), { params: baseParams, body: { newid: 102, full: true, target: 'pve9' } })).status).toBe(200)
    expect(pendingVdcGpus('v1')).toHaveLength(1)
    await runAfterCbs()
    expect(pendingVdcGpus('v1')).toEqual([])
  })

  it('a source without GPU, or the provider, never reads the contingent', async () => {
    resolveVdcForTenantMock.mockResolvedValue(vdc)
    expect((await callRoute(await loadPost(), { params: baseParams, body: { newid: 101, full: false } })).status).toBe(200)
    resolveVdcForTenantMock.mockResolvedValue(null)
    withGpu()
    expect((await callRoute(await loadPost(), { params: baseParams, body: { newid: 102, full: false } })).status).toBe(200)
    expect(cloneContingentCheckMock).not.toHaveBeenCalled()
  })
})

// PVE runs a clone on the source node and keeps its task log there, also for
// a clone to another node: every follow-up polls the node named in the UPID.
describe('POST clone: follow-ups poll the node that runs the task', () => {
  it('IPAM, QoS restamp and HA registration of a clone to another node poll the source node', async () => {
    const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: {
        storagesByConnection: new Map([['conn-1', new Set(['ceph'])]]),
        storagePoliciesByConnection: new Map([['conn-1', new Map([['ceph', gold]])]]),
      },
    })
    resolveSubnetForBridgeMock.mockImplementation(async (_id, bridge) => (bridge === 'tenantA' ? { subnetId: 's1' } : null))
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return path.endsWith('/clone') ? 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:' : null
      if (opts?.method === 'PUT') return null
      if (path === '/storage/ceph') return { type: 'rbd' }
      return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA', scsi0: 'ceph:vm-100-disk-0,size=8G' }
    })

    const res = await callRoute(await loadPost(), { params: baseParams, body: { newid: 150, full: true, target: 'pve9', ha: true } })
    expect(res.status).toBe(200)
    await runAfterCbs()

    expect(waitForTaskMock.mock.calls.map(c => c[1])).toEqual(['pve3', 'pve3', 'pve3'])
  })
})
