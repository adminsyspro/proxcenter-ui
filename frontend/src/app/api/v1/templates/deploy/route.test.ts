import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// The success path schedules the deployment pipeline through after(). Most
// tests only care about the synchronous response, so the callback is merely
// captured (never auto-run); tests that need to exercise the pipeline itself
// (createParams assertions) call runAfters() explicitly.
const afterCbs: Array<() => Promise<void>> = []
vi.mock('next/server', async (io) => {
  const actual = await io<typeof import('next/server')>()
  return { ...actual, after: (fn: () => Promise<void>) => { afterCbs.push(fn) } }
})
async function runAfters() {
  for (const cb of afterCbs) await cb()
}

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const customImageFindUniqueMock = vi.fn<(...args: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    customImage: { findUnique: customImageFindUniqueMock },
    deployment: { create: vi.fn(async () => ({ id: 'dep-1' })), update: vi.fn(async () => ({})) },
    blueprint: { create: vi.fn(async () => ({})) },
  }),
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/schemas', () => ({ deploySchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
const getImageBySlugMock = vi.fn<(...args: any[]) => any>()
vi.mock('@/lib/templates/cloudImages', () => ({ getImageBySlug: getImageBySlugMock, customImageToCloudImage: vi.fn() }))
vi.mock('@/lib/proxmox/storage', () => ({ isFileBasedStorage: () => true, supportsVmDisks: () => true }))
const resolveVdcForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkVdcQuotaMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/vdc/quota', () => ({ resolveVdcForTenant: resolveVdcForTenantMock, checkVdcQuota: checkVdcQuotaMock }))
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/vdc/vnets', async (io) => {
  // The verdict logic is what this file exercises, so it runs for real; only
  // the DB-backed allow-list lookup is stubbed.
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    resolveSubnetForBridge: vi.fn(async () => null),
  }
})
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/ipamScan', () => ({ scanUsedIpsForSubnet: vi.fn(), scannedToIntSet: vi.fn(() => new Set()) }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: vi.fn() }))
const getVdcScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))
const auditMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseBody = {
  connectionId: 'conn-1',
  node: 'pve1',
  vmid: 190,
  imageSlug: 'ubuntu-22.04',
  storage: 'local-lvm',
  hardware: { cores: 1, sockets: 1, memory: 512, ostype: 'l26', cpu: 'host', scsihw: 'virtio-scsi-pci', diskSize: '10G', networkModel: 'virtio', networkBridge: 'vmbr0' },
}

beforeEach(() => {
  afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset()
  customImageFindUniqueMock.mockReset().mockResolvedValue(null)
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  getVdcScopeMock.mockReset().mockResolvedValue(null)
  getImageBySlugMock.mockReset().mockReturnValue(undefined)
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  checkVdcQuotaMock.mockReset().mockResolvedValue({ allowed: true })
  getCurrentTenantIdMock.mockReset().mockResolvedValue('tenant-1')
  auditMock.mockReset().mockResolvedValue({})
})

/** Generic PVE stub covering both deploy pipeline branches (cloud-image
 *  download + ISO download), so the createParams sent to the `qemu` create
 *  call can be captured without hand-rolling every intermediate PVE hop. */
function stubPveFetchForDeploy() {
  pveFetchMock.mockReset()
  pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
    const method = opts?.method
    if (/^\/storage\/[^/]+$/.test(path) && !method) return { type: 'dir', content: 'images,iso,import' }
    if (/\/content\?content=(import|iso)$/.test(path)) return []
    if (/\/download-url$/.test(path) && method === 'POST') return 'UPID:download'
    if (/\/qemu$/.test(path) && method === 'POST') return 'UPID:create'
    return {}
  })
}

/** The URLSearchParams body of the `POST /nodes/.../qemu` create call. */
function qemuCreateParams(): URLSearchParams {
  const call = pveFetchMock.mock.calls.find(
    ([, path, opts]: any) => /\/qemu$/.test(path) && opts?.method === 'POST',
  )
  return call?.[2]?.body as URLSearchParams
}

describe('POST templates/deploy — MSP VMID range enforcement', () => {
  it('400: rejected by range check before PVE is ever touched', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'range' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('range')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('409: already in use', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 409, error: 'in use' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(409)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('ok: passes the gate and reaches the next early-exit (unknown image slug)', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: true })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('Unknown image slug')
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
  })
})

describe('POST templates/deploy: vDC network allow-list', () => {
  /** vmbr0 is shared with a 100-199 pool; vnetacme is an SDN vnet. */
  const scoped = () =>
    new Map([
      ['vmbr0', { kind: 'shared' as const, vlanRanges: [{ start: 100, end: 199 }] }],
      ['vnetacme', { kind: 'vnet' as const, vlanRanges: [] }],
    ])

  /**
   * The network guard sits behind image resolution, the vDC resolution and the
   * storage allow-list. Open all three so each case reaches the guard itself.
   */
  function reachTheGuard() {
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', url: 'https://img.test/u.qcow2' })
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-a', quota: null })
    getVdcScopeMock.mockResolvedValue({
      storagesByConnection: new Map([['conn-1', new Set(['local-lvm'])]]),
    })
  }

  function bodyWith(hw: Record<string, unknown>) {
    return { ...baseBody, hardware: { ...baseBody.hardware, ...hw } }
  }

  it('403: a VLAN tag outside the vDC pools never reaches PVE', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vmbr0', vlanTag: 250 }) })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain("outside your vDC's VLAN pools")
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('400: a non-numeric vlanTag is refused before the bridge probe is built', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vmbr0', vlanTag: '10,tag=250' }) })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('vlanTag must be a positive integer')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: a tag on an SDN vnet is refused', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vnetacme', vlanTag: 150 }) })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: an unknown bridge is still refused', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vmbr42' }) })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('is not authorized')
  })

  it('403: a tag smuggled through networkModel is caught too', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      body: bodyWith({ networkModel: 'virtio,tag=250', networkBridge: 'vmbr0' }),
    })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: a tag smuggled through networkBridge is caught too', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vmbr0,tag=250' }) })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('passes a tag inside the vDC pools through to the deployment', async () => {
    reachTheGuard()
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, { body: bodyWith({ networkBridge: 'vmbr0', vlanTag: 150 }) })
    expect(res.status).toBe(200)
  })
})

describe('POST templates/deploy: storage-policy QoS stamping on deployed disks', () => {
  /** Tenant with a policy bound to body.storage on conn-1. */
  function reachDeployPipeline() {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-a', quota: null, storagePolicies: [] })
    getVdcScopeMock.mockResolvedValue({
      storagesByConnection: new Map([['conn-1', new Set(['local-lvm'])]]),
      storagePoliciesByConnection: new Map([
        ['conn-1', new Map([['local-lvm', { iopsRd: 5000, iopsWr: 3000, mbpsRd: 200, mbpsWr: 100 }]])],
      ]),
    })
  }

  beforeEach(() => { stubPveFetchForDeploy() })

  it('cloud-image branch: scsi0 carries the policy QoS suffix, ide2 stays plain', async () => {
    reachDeployPipeline()
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', downloadUrl: 'https://img.test/u.qcow2' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(200)

    await runAfters()

    const params = qemuCreateParams()
    expect(params.get('scsi0')).toBe(
      'local-lvm:0,import-from=local-lvm:import/u.qcow2,iops_rd=5000,iops_wr=3000,mbps_rd=200,mbps_wr=100',
    )
    expect(params.get('ide2')).toBe('local-lvm:cloudinit')
  })

  it('ISO branch: scsi0 carries the suffix, ide2 and efidisk0 stay plain', async () => {
    reachDeployPipeline()
    getImageBySlugMock.mockReturnValue({ slug: 'debian-12', format: 'iso', downloadUrl: 'https://img.test/d.iso' })
    const POST = await loadPost()
    const res = await callRoute(POST, {
      body: { ...baseBody, isoStorage: 'local-lvm', hardware: { ...baseBody.hardware, bios: 'ovmf' } },
    })
    expect(res.status).toBe(200)

    await runAfters()

    const params = qemuCreateParams()
    expect(params.get('scsi0')).toBe('local-lvm:10,iops_rd=5000,iops_wr=3000,mbps_rd=200,mbps_wr=100')
    expect(params.get('ide2')).toBe('local-lvm:iso/d.iso,media=cdrom')
    expect(params.get('efidisk0')).toBe('local-lvm:1,efitype=4m,pre-enrolled-keys=1')
  })

  it('provider deploy: scope is never fetched, so no suffix is stamped', async () => {
    getCurrentTenantIdMock.mockResolvedValue('default')
    resolveVdcForTenantMock.mockResolvedValue(null)
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', downloadUrl: 'https://img.test/u.qcow2' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(200)

    await runAfters()

    const params = qemuCreateParams()
    expect(params.get('scsi0')).toBe('local-lvm:0,import-from=local-lvm:import/u.qcow2')
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })
})

describe('POST templates/deploy: storage-policy tier quota', () => {
  it('409 before any PVE call when the tier quota is exceeded', async () => {
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', downloadUrl: 'https://img.test/u.qcow2' })
    const storagePolicies = [{ policyId: 'p1', name: 'gold', storageId: 'local-lvm', quotaMb: 1024 }]
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-a', quota: null, storagePolicies })
    checkVdcQuotaMock.mockResolvedValue({
      allowed: false,
      violations: ['gold: 1024/1024 MB, +10240 MB exceeds tier quota'],
      currentUsage: { vcpus: 0, ramMb: 0, storageMb: 0, vms: 0, snapshots: 0, backups: 0 },
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(409)
    const json = await readJson<{ violations: string[] }>(res)
    expect(json?.violations).toEqual(['gold: 1024/1024 MB, +10240 MB exceeds tier quota'])
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(checkVdcQuotaMock).toHaveBeenCalledWith(
      'conn-1',
      'pool-a',
      null,
      expect.objectContaining({ addStorageMbByStorage: { 'local-lvm': 10240 } }),
      storagePolicies,
      'pve1',
    )
  })
})
