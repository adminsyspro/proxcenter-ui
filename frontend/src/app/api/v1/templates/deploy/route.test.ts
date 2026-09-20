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
const findCustomImageForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()

const deploymentUpdateMock = vi.fn<(...args: any[]) => Promise<any>>()

const blueprintFindUniqueMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    customImage: { findUnique: customImageFindUniqueMock },
    deployment: { create: vi.fn(async () => ({ id: 'dep-1' })), update: deploymentUpdateMock },
    blueprint: { create: vi.fn(async () => ({})), findUnique: (...a: any[]) => blueprintFindUniqueMock(...a) },
  }),
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { VM_CREATE: 'vm.create', VM_CLONE: 'vm.clone' }, buildVmResourceId: (...parts: string[]) => parts.join(':') }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/schemas', () => ({ deploySchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
const getImageBySlugMock = vi.fn<(...args: any[]) => any>()
vi.mock('@/lib/templates/cloudImages', () => ({ customImageToCloudImage: vi.fn() }))
vi.mock('@/lib/templates/catalogStore', () => ({ resolveBuiltInImage: getImageBySlugMock }))
vi.mock('@/lib/templates/customImageScope', () => ({ findCustomImageForTenant: findCustomImageForTenantMock }))
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
// Spread the real module: the route also imports the pure helpers
// writableStoragesFor / readOnlyLibraryError (#894); only the DB-backed
// scope loader is stubbed.
vi.mock('@/lib/vdc/scope', async (io) => {
  const actual = await io<typeof import('@/lib/vdc/scope')>()
  return { ...actual, getVdcScope: getVdcScopeMock, loadTenantSlugs: async () => ({ mine: 'acme', all: ['acme', 'acme-prod'] }) }
})
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: async () => ({ kind: 'iaas', vdcScope: await getVdcScopeMock() }) }))
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

beforeEach(async () => {
  const { resolveSubnetForBridge } = await import('@/lib/vdc/vnets')
  afterCbs.length = 0
  deploymentUpdateMock.mockReset().mockResolvedValue({})
  vi.mocked(resolveSubnetForBridge).mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset()
  customImageFindUniqueMock.mockReset().mockResolvedValue(null)
  findCustomImageForTenantMock.mockReset().mockResolvedValue(null)
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
    if (path.startsWith('/access/permissions?')) {
      const key = new URLSearchParams(path.split('?')[1]).get('path')!
      return { [key]: { 'Sys.Audit': 1, 'Sys.Modify': 1, 'Datastore.AllocateTemplate': 1 } }
    }
    if (path === '/nodes/pve1/storage') return [{ storage: 'local-lvm', type: 'dir', content: 'images,iso,import', active: 1, enabled: 1 }]
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

  // A template the provider shared with every tenant is listed by the
  // catalogue but used to be resolved under the caller's own tenant only, so
  // the deploy died on "Unknown image slug" while the wizard had just offered
  // it. The resolver is now the shared-scope one, and the slug must get past
  // this early exit for a row the caller does not own.
  it('resolves a template shared by the provider instead of refusing the slug', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: true })
    findCustomImageForTenantMock.mockResolvedValue({
      tenantId: 'default',
      slug: 'custom-fortigate',
      isShared: true,
      sourceType: 'volume',
      volumeId: 'nfs-library:import/fortios.qcow2',
    })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).not.toBe('Unknown image slug')
    expect(findCustomImageForTenantMock).toHaveBeenCalledWith('tenant-1', baseBody.imageSlug)
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

describe('POST templates/deploy: read-only ISO library (#894)', () => {
  function libraryScope() {
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', downloadUrl: 'https://img.test/u.qcow2' })
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-a', quota: null, storagePolicies: [] })
    getVdcScopeMock.mockResolvedValue({
      storagesByConnection: new Map([['conn-1', new Set(['local-lvm', 'isolib'])]]),
      writableStoragesByConnection: new Map([['conn-1', new Set(['local-lvm'])]]),
      isoLibrariesByConnection: new Map([['conn-1', new Set(['isolib'])]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map()]]),
    })
  }

  it('403: the data disk cannot land on a library storage', async () => {
    libraryScope()
    const POST = await loadPost()
    const res = await callRoute(POST, { body: { ...baseBody, storage: 'isolib' } })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/read-only ISO library/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: an ISO downloaded from a URL cannot be written onto a library storage', async () => {
    libraryScope()
    const POST = await loadPost()
    const res = await callRoute(POST, { body: { ...baseBody, isoStorage: 'isolib' } })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/read-only ISO library/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a visible-but-unwritable storage outside the library set keeps the generic refusal', async () => {
    libraryScope()
    const POST = await loadPost()
    const res = await callRoute(POST, { body: { ...baseBody, storage: 'elsewhere' } })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/not authorised/)
  })
})

describe('POST templates/deploy: vDC compute policy (#893)', () => {
  const withPolicy = (computePolicy: any) => ({ poolName: 'pool-a', quota: null, storagePolicies: [], computePolicy })
  const SELECTED = { cpuModelMode: 'selected', cpuAllowedModels: ['x86-64-v2-AES', 'x86-64-v3'], cpuDefaultModel: 'x86-64-v3', cpuAdvancedSettings: true }

  async function deploy(body: any) {
    const POST = await loadPost()
    return callRoute(POST, { body })
  }

  beforeEach(() => {
    stubPveFetchForDeploy()
    blueprintFindUniqueMock.mockReset().mockResolvedValue(null)
    getVdcScopeMock.mockResolvedValue({
      storagesByConnection: new Map([['conn-1', new Set(['local-lvm'])]]),
      storagePoliciesByConnection: new Map(),
    })
    getImageBySlugMock.mockReturnValue({ slug: 'ubuntu-22.04', format: 'qcow2', downloadUrl: 'https://img.test/u.qcow2' })
  })

  it('replaces the wizard default model by the vDC default when it is outside the allowed set', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy(SELECTED))
    const res = await deploy(baseBody)   // the wizard always sends `host`
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('x86-64-v3')
  })

  it('keeps a requested model the policy allows, and falls back to the first allowed one without a default', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy({ ...SELECTED, cpuDefaultModel: null }))
    let res = await deploy({ ...baseBody, hardware: { ...baseBody.hardware, cpu: 'x86-64-v2-AES' } })
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('x86-64-v2-AES')

    afterCbs.length = 0
    stubPveFetchForDeploy()
    res = await deploy(baseBody)
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('x86-64-v2-AES')
  })

  it('400 when the policy allows no model on this cluster', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy({ ...SELECTED, cpuAllowedModels: [], cpuDefaultModel: null }))
    const res = await deploy(baseBody)
    expect(res.status).toBe(400)
    expect((await readJson<{ error: string }>(res))?.error).toBe('The vDC compute policy allows no CPU model on this cluster.')
    expect(afterCbs).toHaveLength(0)
  })

  it('400 on CPU flags while the advanced settings are locked, even in unrestricted model mode', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy({ cpuModelMode: 'unrestricted', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: false }))
    const res = await deploy({ ...baseBody, hardware: { ...baseBody.hardware, cpu: 'host,flags=+aes' } })
    expect(res.status).toBe(400)
    expect((await readJson<{ error: string }>(res))?.error).toBe('CPU flags and advanced CPU options are disabled by the vDC compute policy.')
  })

  it("keeps the model of a provider blueprint outside the allowed set, but not a tenant's own", async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy(SELECTED))
    blueprintFindUniqueMock.mockResolvedValue({ tenantId: 'default', hardware: { cpu: 'host' } })
    let res = await deploy({ ...baseBody, blueprintId: 'bp-provider' })
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('host')
    expect(blueprintFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bp-provider' } }))

    afterCbs.length = 0
    stubPveFetchForDeploy()
    blueprintFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-1', hardware: { cpu: 'host' } })
    res = await deploy({ ...baseBody, blueprintId: 'bp-own' })
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('x86-64-v3')
  })

  it('ignores a blueprint lookup that fails and applies the policy', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy(SELECTED))
    blueprintFindUniqueMock.mockRejectedValue(new Error('db down'))
    const res = await deploy({ ...baseBody, blueprintId: 'bp-gone' })
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('x86-64-v3')
  })

  /** The deploy stub plus the cluster's custom CPU models (cpu-models.conf). */
  function stubPveFetchWithCustomModels() {
    pveFetchMock.mockReset()
    pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
      if (path === '/nodes/pve1/capabilities/qemu/cpu') return [{ name: 'gold', custom: 1 }, { name: 'silver', custom: 1 }, { name: 'host', custom: 0 }]
      if (path.startsWith('/access/permissions?')) {
        const key = new URLSearchParams(path.split('?')[1]).get('path')!
        return { [key]: { 'Sys.Audit': 1, 'Sys.Modify': 1, 'Datastore.AllocateTemplate': 1 } }
      }
      if (path === '/nodes/pve1/storage') return [{ storage: 'local-lvm', type: 'dir', content: 'images,iso,import', active: 1, enabled: 1 }]
      if (/^\/storage\/[^/]+$/.test(path) && !opts?.method) return { type: 'dir', content: 'images,iso,import' }
      if (/\/content\?content=(import|iso)$/.test(path)) return []
      if (/\/download-url$/.test(path) && opts?.method === 'POST') return 'UPID:download'
      if (/\/qemu$/.test(path) && opts?.method === 'POST') return 'UPID:create'
      return {}
    })
  }
  const CUSTOM = { cpuModelMode: 'custom', cpuAllowedModels: [], cpuDefaultModel: 'custom-gold', cpuAdvancedSettings: true }

  it('custom mode reads the cluster capabilities and keeps a custom model the cluster defines', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy(CUSTOM))
    stubPveFetchWithCustomModels()
    const res = await deploy({ ...baseBody, hardware: { ...baseBody.hardware, cpu: 'custom-silver' } })
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('custom-silver')
  })

  it('custom mode replaces a built-in model by the vDC default custom model', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy(CUSTOM))
    stubPveFetchWithCustomModels()
    const res = await deploy(baseBody)
    expect(res.status).toBe(200)
    await runAfters()
    expect(qemuCreateParams().get('cpu')).toBe('custom-gold')
  })

  it('custom mode without readable capabilities allows no model: 400', async () => {
    resolveVdcForTenantMock.mockResolvedValue(withPolicy({ cpuModelMode: 'custom', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: true }))
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path.endsWith('/capabilities/qemu/cpu')) throw new Error('node down')
      return {}
    })
    const res = await deploy(baseBody)
    expect(res.status).toBe(400)
    expect((await readJson<{ error: string }>(res))?.error).toBe('The vDC compute policy allows no CPU model on this cluster.')
  })
})

describe('template download regressions (#967)', () => {
  beforeEach(() => {
    getCurrentTenantIdMock.mockResolvedValue('default')
    getImageBySlugMock.mockReturnValue({ slug: 'debian-12', format: 'qcow2', downloadUrl: 'https://image.test/debian.qcow2' })
    stubPveFetchForDeploy()
  })

  async function deploy(body = baseBody) {
    const POST = await loadPost()
    const response = await callRoute(POST, { body })
    expect(response.status).toBe(200)
    await runAfters()
  }
  const finalUpdate = () => deploymentUpdateMock.mock.calls.at(-1)?.[0].data
  const mutations = () => pveFetchMock.mock.calls.filter(([, , options]) => options?.method)

  it('records completion time and missing network rights on a failed download without writing to PVE', async () => {
    const original = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (...args) => {
      if (args[1].startsWith('/access/permissions?')) {
        const path = new URLSearchParams(args[1].split('?')[1]).get('path')!
        return { [path]: { 'Datastore.AllocateTemplate': 1, 'Sys.Audit': 1 } }
      }
      return original(...args)
    })
    await deploy()
    expect(finalUpdate()).toMatchObject({ status: 'failed', completedAt: expect.any(Date), error: expect.stringContaining('Sys.AccessNetwork on /nodes/pve1') })
    expect(mutations()).toEqual([])
  })

  it('keeps the step the deployment died on so the progress screen can show the reason', async () => {
    const original = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (...args) => {
      if (args[1].startsWith('/access/permissions?')) {
        const path = new URLSearchParams(args[1].split('?')[1]).get('path')!
        return { [path]: { 'Datastore.AllocateTemplate': 1, 'Sys.Audit': 1 } }
      }
      return original(...args)
    })
    await deploy()
    // Writing currentStep: 'failed' would erase the step and leave the stepper
    // with nothing to mark, which is how the reason went missing (#967).
    expect(finalUpdate()).not.toHaveProperty('currentStep')
    expect(deploymentUpdateMock.mock.calls.map(([u]) => u.data.currentStep).filter(Boolean).at(-1)).toBe('downloading')
  })

  it('does not change storage configuration when no import storage exists', async () => {
    const original = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (...args) => {
      if (args[1] === '/nodes/pve1/storage') return [{ storage: 'backup', type: 'nfs', content: 'backup', active: 1, enabled: 1 }]
      return original(...args)
    })
    await deploy()
    expect(finalUpdate()).toMatchObject({ status: 'failed', error: expect.stringContaining('Import content enabled') })
    expect(mutations()).toEqual([])
  })

  it('reuses a cached image without needing network privileges and exposes the selected storage', async () => {
    const original = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (...args) => {
      if (args[1].endsWith('/content?content=import')) return [{ volid: 'local-lvm:import/debian.qcow2' }]
      return original(...args)
    })
    await deploy()
    expect(pveFetchMock.mock.calls.some(([, path]) => path.startsWith('/access/permissions?') || path.endsWith('/download-url'))).toBe(false)
    expect(qemuCreateParams().get('scsi0')).toContain('import-from=local-lvm:import/debian.qcow2')
    expect(deploymentUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ config: expect.objectContaining({ downloadStorage: 'local-lvm' }) }) }))
    expect(finalUpdate()).toMatchObject({ status: 'completed', completedAt: expect.any(Date) })
  })

  it('uses the same preflight for installer ISO downloads', async () => {
    getImageBySlugMock.mockReturnValue({ slug: 'installer', format: 'iso', downloadUrl: 'https://image.test/installer.iso' })
    const original = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (...args) => {
      if (args[1].startsWith('/access/permissions?')) return {}
      return original(...args)
    })
    await deploy({ ...baseBody, isoStorage: 'iso-store' } as typeof baseBody)
    expect(finalUpdate()).toMatchObject({ status: 'failed', error: expect.stringContaining('/storage/iso-store'), completedAt: expect.any(Date) })
    expect(mutations()).toEqual([])
  })

  it('keeps IPAM exhaustion in Deployment.error instead of sending errorMessage to Prisma', async () => {
    const { resolveSubnetForBridge } = await import('@/lib/vdc/vnets')
    const { allocateIp, IpamExhaustedError } = await import('@/lib/vdc/ipam')
    vi.mocked(resolveSubnetForBridge).mockResolvedValue({ subnetId: 'subnet-1', cidr: '10.1.0.0/30', dnsServers: [], gateway: '10.1.0.1', pveName: 'vnet1', pvePoolName: 'pool' } as any)
    vi.mocked(allocateIp).mockRejectedValue(new IpamExhaustedError('full'))
    await deploy()
    expect(finalUpdate()).toMatchObject({ status: 'failed', error: expect.stringContaining('Subnet 10.1.0.0/30 is full'), completedAt: expect.any(Date) })
    expect(deploymentUpdateMock.mock.calls.every(([update]) => !('errorMessage' in update.data))).toBe(true)
    expect(qemuCreateParams()).toBeUndefined()
  })
})

describe('POST templates/deploy: source volume authorization', () => {
  const source = {
    tenantId: 'tenant-1', isShared: false, sourceType: 'volume', format: 'qcow2',
    volumeId: 'local-lvm:vm-201-disk-0', sourceConnectionId: 'conn-1', sourceNode: 'pve1',
  }
  beforeEach(async () => {
    const { customImageToCloudImage } = await import('@/lib/templates/cloudImages')
    vi.mocked(customImageToCloudImage).mockImplementation((row: any) => row)
    findCustomImageForTenantMock.mockResolvedValue({ ...source })
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool-a', quota: null })
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(['pve1'])]]),
      storagesByConnection: new Map([['conn-1', new Set(['local-lvm', 'library'])]]),
      writableStoragesByConnection: new Map([['conn-1', new Set(['local-lvm'])]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-a'])]]),
      isoLibrariesByConnection: new Map([['conn-1', new Set(['library'])]]),
    })
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/content')) return [{ volid: source.volumeId, content: 'images', vmid: 201 }]
      if (path === '/cluster/resources?type=vm') return [{ vmid: 201, type: 'qemu', node: 'pve1', pool: 'pool-b' }]
      return {}
    })
  })

  it('rejects a legacy malicious row even when its destination is writable', async () => {
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(403)
    expect(afterCbs).toHaveLength(0)
  })

  it('rejects a source storage removed from the tenant scope since image creation', async () => {
    findCustomImageForTenantMock.mockResolvedValue({ ...source, volumeId: 'foreign:vm-201-disk-0' })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(403)
    expect(afterCbs).toHaveLength(0)
  })

  it('requires an origin for old unbound images instead of guessing a cluster', async () => {
    findCustomImageForTenantMock.mockResolvedValue({ ...source, sourceConnectionId: null, sourceNode: null })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(409)
    expect(afterCbs).toHaveLength(0)
  })

  it('preserves a provider shared image with an explicit source', async () => {
    findCustomImageForTenantMock.mockResolvedValue({ ...source, tenantId: 'default', isShared: true })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(200)
    expect(afterCbs).toHaveLength(1)
  })

  it('does not let a forged isShared in the deployment body confer source access', async () => {
    const res = await callRoute(await loadPost(), { body: { ...baseBody, isShared: true, tenantId: 'default' } })
    expect(res.status).toBe(403)
    expect(afterCbs).toHaveLength(0)
  })

  it('rejects another tenant ISO despite a permitted isoStorage decoy', async () => {
    findCustomImageForTenantMock.mockResolvedValue({ ...source, format: 'iso', volumeId: 'library:iso/custom-acme-prod-private.iso' })
    pveFetchMock.mockResolvedValue([{ volid: 'library:iso/custom-acme-prod-private.iso', content: 'iso' }])
    const res = await callRoute(await loadPost(), { body: { ...baseBody, isoStorage: 'library' } })
    expect(res.status).toBe(403)
    expect(afterCbs).toHaveLength(0)
  })

  it('imports a tenant-owned disk through the background deployment pipeline', async () => {
    pveFetchMock.mockImplementation(async (_conn, path, opts) => {
      if (path.endsWith('/content')) return [{ volid: source.volumeId, content: 'images', vmid: 201 }]
      if (path === '/cluster/resources?type=vm') return [{ vmid: 201, type: 'qemu', node: 'pve1', pool: 'pool-a' }]
      if (path.endsWith('/qemu') && opts?.method === 'POST') return 'UPID:create'
      return {}
    })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(200)
    await runAfters()
    expect(String(qemuCreateParams().get('scsi0'))).toContain('import-from=local-lvm:vm-201-disk-0')
    expect(deploymentUpdateMock.mock.calls.some(call => call[0].data.status === 'completed')).toBe(true)
  })

  it.each(['removed', 'changed', 'unpublished'])('fails before PVE writes when a shared source is %s after the response', async change => {
    findCustomImageForTenantMock.mockResolvedValue({ ...source, tenantId: 'default', isShared: true })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(200)
    findCustomImageForTenantMock.mockResolvedValue(change === 'removed' ? null : {
      ...source, tenantId: 'default', isShared: change !== 'unpublished',
      volumeId: change === 'changed' ? 'local-lvm:vm-999-disk-0' : source.volumeId,
    })
    await runAfters()
    expect(pveFetchMock.mock.calls.some(call => call[2]?.method === 'POST' || call[2]?.method === 'PUT')).toBe(false)
    expect(deploymentUpdateMock.mock.calls.some(call => call[0].data.status === 'failed' && call[0].data.completedAt instanceof Date)).toBe(true)
  })

  it('rejects storage scope revoked between acceptance and background execution', async () => {
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/content')) return [{ volid: source.volumeId, content: 'images', vmid: 201 }]
      if (path === '/cluster/resources?type=vm') return [{ vmid: 201, type: 'qemu', node: 'pve1', pool: 'pool-a' }]
      return {}
    })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(200)
    const changedScope = await getVdcScopeMock()
    changedScope.storagesByConnection.get('conn-1').delete('local-lvm')
    await runAfters()
    expect(pveFetchMock.mock.calls.some(call => call[2]?.method === 'POST' || call[2]?.method === 'PUT')).toBe(false)
    expect(deploymentUpdateMock.mock.calls.some(call => call[0].data.status === 'failed')).toBe(true)
  })

  it('deploys a provider shared image whose source sits outside the tenant vDC (#971)', async () => {
    const golden = { ...source, tenantId: 'default', isShared: true, volumeId: 'provider-store:import/golden.qcow2', sourceNode: 'pve3' }
    findCustomImageForTenantMock.mockResolvedValue(golden)
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/content')) return [{ volid: golden.volumeId, content: 'import' }]
      if (path.startsWith('/storage/')) return { shared: 1, type: 'nfs' }
      return {}
    })
    const res = await callRoute(await loadPost(), { body: baseBody })
    expect(res.status).toBe(200)
    expect(afterCbs).toHaveLength(1)
  })
})
