import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  vdcMoveCount: vi.fn(),
  vdcMoveCreate: vi.fn(),
  vdcMoveUpdate: vi.fn(),
  vdcMoveUpdateMany: vi.fn(),
  loadTenantVdcs: vi.fn(),
  findVdcByPool: vi.fn(),
  loadPveConnection: vi.fn(),
  captureReplicationJobs: vi.fn(),
  findSiteRecoveryJobsForGuest: vi.fn(),
  buildRemoteMigrateEndpoint: vi.fn(),
  checkVdcQuota: vi.fn(),
  getVdcStorageUsedMb: vi.fn(),
  loadVdcMoveSettings: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { vdcMove: { count: h.vdcMoveCount, create: h.vdcMoveCreate, update: h.vdcMoveUpdate, updateMany: h.vdcMoveUpdateMany } },
}))
vi.mock('@/lib/migration/ccm-prereqs', () => ({
  captureReplicationJobs: h.captureReplicationJobs,
  findSiteRecoveryJobsForGuest: h.findSiteRecoveryJobsForGuest,
}))
vi.mock('@/lib/migration/remoteMigrateEndpoint', () => ({ buildRemoteMigrateEndpoint: h.buildRemoteMigrateEndpoint }))
vi.mock('@/lib/migration/orphan-sweep', () => ({ resolveInstanceId: () => 'replica-a' }))
vi.mock('@/lib/vdc/quota', () => ({ checkVdcQuota: h.checkVdcQuota, getVdcStorageUsedMb: h.getVdcStorageUsedMb }))
vi.mock('./settings', async (orig) => ({ ...(await orig<any>()), loadVdcMoveSettings: h.loadVdcMoveSettings }))
vi.mock('./context', async (orig) => ({
  ...(await orig<any>()),
  loadTenantVdcs: h.loadTenantVdcs,
  findVdcByPool: h.findVdcByPool,
  loadPveConnection: h.loadPveConnection,
}))

import {
  defaultMapping,
  getMoveOptions,
  planMove,
  recordProviderMigrationAsMove,
  resolveMoveSource,
  startMove,
  MoveRequestError,
  type MoveActor,
} from './service'
import type { MoveVdc } from './context'

const TENANT: MoveActor = { tenantId: 'acme', isProvider: false, userEmail: 'ops@acme.test' }
const PROVIDER: MoveActor = { tenantId: 'default', isProvider: true }
const CAPS = { iopsRd: 500, iopsWr: null, mbpsRd: null, mbpsWr: null }

function vdc(over: Partial<MoveVdc> = {}): MoveVdc {
  return {
    id: 'vdc-src',
    tenantId: 'acme',
    name: 'Paris',
    connectionId: 'conn-a',
    poolName: 'vdc-acme-paris',
    nodes: new Set(),
    primaryStorage: 'ceph',
    policies: [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-gold', quotaMb: null, caps: CAPS }],
    networks: [{ bridge: 'tnet01', label: 'lan', kind: 'vnet', vnetId: 'vn-a', tenantNetworkId: 'net-lan' }],
    vlanRanges: new Map(),
    quota: null,
    computePolicy: { cpuModelMode: 'unrestricted', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: true },
    ...over,
  }
}

const SOURCE_VDC = vdc()
const TARGET_VDC = vdc({
  id: 'vdc-dst',
  name: 'Lyon',
  connectionId: 'conn-b',
  poolName: 'vdc-acme-lyon',
  primaryStorage: 'rbd',
  policies: [{ policyId: 'p2', name: 'gold', storageId: 'nvme-gold', quotaMb: 102400, caps: { iopsRd: 1000, iopsWr: 1000, mbpsRd: null, mbpsWr: null } }],
  networks: [
    { bridge: 'tnet01', label: 'lan', kind: 'vnet', vnetId: 'vn-b', tenantNetworkId: 'net-lan' },
    { bridge: 'vmbr1', label: 'WAN', kind: 'shared', vnetId: null, tenantNetworkId: null },
  ],
})

const CONFIG = {
  name: 'web-01',
  cores: 2,
  memory: 2048,
  scsi0: 'ceph-gold:vm-105-disk-0,iops_rd=500,size=20G',
  net0: 'virtio=BC:24:11:00:00:01,bridge=tnet01',
}

const SOURCE_RESOURCES = [{ vmid: 105, type: 'qemu', node: 'pve1', pool: 'vdc-acme-paris', name: 'web-01', status: 'running' }]

function targetResources(over: { vmTaken?: boolean; storageOff?: boolean } = {}) {
  return [
    { type: 'node', node: 'pve1-dr', status: 'online', maxmem: 64 * 1024 ** 3, mem: 8 * 1024 ** 3 },
    { type: 'storage', node: 'pve1-dr', storage: 'nvme-gold', status: over.storageOff ? 'unknown' : 'available' },
    ...(over.vmTaken ? [{ type: 'qemu', vmid: 105, node: 'pve1-dr', name: 'other-tenant-vm' }] : []),
  ]
}

function routePve(map: Record<string, unknown>) {
  h.pveFetch.mockImplementation(async (conn: any, path: string) => {
    const key = `${conn.id} ${path}`
    for (const [k, v] of Object.entries(map)) {
      if (key === k || key.startsWith(k)) {
        if (v instanceof Error) throw v
        return typeof v === 'function' ? (v as any)() : v
      }
    }
    return undefined
  })
}

function defaultPve(over: Record<string, unknown> = {}) {
  routePve({
    'conn-a /cluster/resources?type=vm': SOURCE_RESOURCES,
    'conn-a /nodes/pve1/qemu/105/config': CONFIG,
    'conn-a /nodes/pve1/qemu/105/snapshot': [{ name: 'current' }],
    'conn-a /cluster/ha/resources': [],
    'conn-b /cluster/resources': targetResources(),
    'conn-b /pools/vdc-acme-lyon': { members: [{ type: 'qemu', vmid: 300, node: 'pve1-dr' }] },
    'conn-a /nodes/pve1/qemu/105/remote_migrate': 'UPID:pve1:1:2:3:qmigrate:105:root@pam:',
    ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadPveConnection.mockImplementation(async (id: string) => ({ id }))
  h.findVdcByPool.mockImplementation(async (conn: string, pool: string) => (conn === 'conn-a' && pool === 'vdc-acme-paris' ? SOURCE_VDC : null))
  h.loadTenantVdcs.mockResolvedValue([SOURCE_VDC, TARGET_VDC])
  h.vdcMoveCount.mockResolvedValue(0)
  h.captureReplicationJobs.mockResolvedValue([])
  h.findSiteRecoveryJobsForGuest.mockResolvedValue([])
  h.checkVdcQuota.mockResolvedValue({ allowed: true, violations: [], currentUsage: {} })
  h.getVdcStorageUsedMb.mockResolvedValue(2048)
  h.loadVdcMoveSettings.mockResolvedValue({ tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 })
  h.buildRemoteMigrateEndpoint.mockResolvedValue({ ok: true, endpoint: 'apitoken=x,host=10.0.0.2', host: '10.0.0.2', apiFingerprint: true })
  defaultPve()
})

describe('resolveMoveSource', () => {
  it('trusts the guest status over a cluster listing that lags behind a start', async () => {
    defaultPve({
      'conn-a /cluster/resources?type=vm': [{ ...SOURCE_RESOURCES[0], status: 'stopped' }],
      'conn-a /nodes/pve1/qemu/105/status/current': { status: 'running' },
    })
    expect((await resolveMoveSource(TENANT, 'conn-a', 'pve1', 105)).running).toBe(true)
  })

  it('answers not found for a guest of another tenant, never forbidden', async () => {
    await expect(resolveMoveSource({ ...TENANT, tenantId: 'other' }, 'conn-a', 'pve1', 105)).rejects.toMatchObject({ status: 404, code: 'GUEST_NOT_FOUND' })
  })

  it('answers not found when the node in the path is not the guest node', async () => {
    await expect(resolveMoveSource(TENANT, 'conn-a', 'pve2', 105)).rejects.toMatchObject({ status: 404 })
  })

  it('tells the provider the guest is in no vDC', async () => {
    defaultPve({ 'conn-a /cluster/resources?type=vm': [{ ...SOURCE_RESOURCES[0], pool: undefined }] })
    await expect(resolveMoveSource(PROVIDER, 'conn-a', 'pve1', 105)).rejects.toMatchObject({ status: 400, code: 'NOT_IN_VDC' })
    await expect(resolveMoveSource(TENANT, 'conn-a', 'pve1', 105)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a container', async () => {
    defaultPve({ 'conn-a /cluster/resources?type=vm': [{ ...SOURCE_RESOURCES[0], type: 'lxc' }] })
    await expect(resolveMoveSource(TENANT, 'conn-a', 'pve1', 105)).rejects.toBeInstanceOf(MoveRequestError)
  })
})

describe('getMoveOptions', () => {
  it('lists the other vDCs and describes the first one with its tier usage', async () => {
    const options = await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)
    expect(options.sourceVdc).toEqual({ id: 'vdc-src', name: 'Paris' })
    expect(options.targets).toEqual([{ vdcId: 'vdc-dst', name: 'Lyon' }])
    expect(options.blockers).toEqual([])
    expect(options.target?.storages).toEqual([
      { storage: 'nvme-gold', primary: false, policy: { name: 'gold', iopsRd: 1000, iopsWr: 1000, mbpsRd: null, mbpsWr: null }, quotaMb: 102400, usedMb: 2048 },
      { storage: 'rbd', primary: true, policy: null, quotaMb: null, usedMb: null },
    ])
    expect(options.target?.defaults).toEqual({ storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'tnet01' } })
  })

  it('reports the source blockers a tenant cannot lift', async () => {
    defaultPve({
      'conn-a /nodes/pve1/qemu/105/snapshot': [{ name: 'before-upgrade' }, { name: 'current' }],
      'conn-a /cluster/ha/resources': [{ sid: 'vm:105' }],
      'conn-a /nodes/pve1/qemu/105/config': { ...CONFIG, lock: 'backup' },
    })
    h.captureReplicationJobs.mockResolvedValue([{ id: '105-0' }])
    h.findSiteRecoveryJobsForGuest.mockResolvedValue([{ id: 'sr' }])
    const { blockers } = await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)
    expect(blockers.map((b) => b.code)).toEqual(['GUEST_LOCKED', 'SNAPSHOTS_PRESENT', 'HA_MANAGED', 'REPLICATION_CONFIGURED', 'SITE_RECOVERY_JOB'])
  })

  it('bounds the moves of a tenant, not those of the provider', async () => {
    h.vdcMoveCount.mockImplementation(async ({ where }: any) => (where.vmid ? 0 : 1))
    expect((await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)).blockers).toEqual([{ code: 'TOO_MANY_MOVES', context: { max: 1 } }])
    expect((await getMoveOptions(PROVIDER, 'conn-a', 'pve1', 105)).blockers).toEqual([])
  })

  it('reports a move already running for this guest', async () => {
    h.vdcMoveCount.mockResolvedValue(1)
    expect((await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)).blockers).toEqual([{ code: 'MOVE_IN_PROGRESS' }])
  })

  it('lets the provider switch tenant self-service off', async () => {
    h.loadVdcMoveSettings.mockResolvedValue({ tenantSelfService: false, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 })
    expect((await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)).blockers).toContainEqual({ code: 'SELF_SERVICE_DISABLED' })
    expect((await getMoveOptions(PROVIDER, 'conn-a', 'pve1', 105)).blockers).toEqual([])
  })

  it('shows an empty tier as unused without listing the storage', async () => {
    defaultPve({ 'conn-b /pools/vdc-acme-lyon': { members: [] } })
    const options = await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)
    expect(options.target?.storages[0].usedMb).toBe(0)
    expect(h.getVdcStorageUsedMb).not.toHaveBeenCalled()
  })

  it('says when the tenant has no other vDC', async () => {
    h.loadTenantVdcs.mockResolvedValue([SOURCE_VDC])
    const options = await getMoveOptions(TENANT, 'conn-a', 'pve1', 105)
    expect(options.blockers).toContainEqual({ code: 'NO_OTHER_VDC' })
    expect(options.target).toBeNull()
  })

  it('refuses a target vDC that is not one of the tenant', async () => {
    await expect(getMoveOptions(TENANT, 'conn-a', 'pve1', 105, 'vdc-of-someone-else')).rejects.toMatchObject({ status: 404 })
  })
})

describe('defaultMapping', () => {
  it('falls back to the primary storage and leaves an unknown network unset', () => {
    const source = { inspected: { storages: [{ storage: 'local', disks: ['scsi0'], sizeMb: 1 }], bridges: [{ bridge: 'vmbr9', nics: ['net0'], tags: [] }] }, vdc: SOURCE_VDC } as any
    expect(defaultMapping(source, TARGET_VDC)).toEqual({ storageMap: { local: 'rbd' }, bridgeMap: {} })
  })
})

const REQUEST = { targetVdcId: 'vdc-dst', storageMap: { 'ceph-gold': 'nvme-gold', unused: 'rbd' }, bridgeMap: { tnet01: 'tnet01' }, online: true }

describe('planMove', () => {
  it('plans a live copy onto the least loaded authorised node, keeping the VMID', async () => {
    const { blockers, plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(blockers).toEqual([])
    expect(plan).toMatchObject({ targetNode: 'pve1-dr', targetVmid: 105, online: true, mapping: { storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'tnet01' } } })
    expect(h.checkVdcQuota).toHaveBeenCalledWith('conn-b', 'vdc-acme-lyon', null, expect.objectContaining({
      addVcpus: 2, addRamMb: 2048, addStorageMb: 20480, addVms: 1, addStorageMbByStorage: { 'nvme-gold': 20480 },
    }), [{ policyId: 'p2', name: 'gold', storageId: 'nvme-gold', quotaMb: 102400 }], 'pve1-dr')
  })

  it('reports a taken VMID without naming the guest that holds it', async () => {
    defaultPve({ 'conn-b /cluster/resources': targetResources({ vmTaken: true }) })
    const { blockers, plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(plan).toBeNull()
    expect(blockers).toEqual([{ code: 'VMID_TAKEN_ON_TARGET', context: { vmid: 105 } }])
    expect(JSON.stringify(blockers)).not.toContain('other-tenant-vm')
    expect(JSON.stringify(blockers)).not.toContain('pve1-dr')
  })

  it('needs a node where the chosen storage is active', async () => {
    defaultPve({ 'conn-b /cluster/resources': targetResources({ storageOff: true }) })
    const { blockers } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(blockers).toEqual([{ code: 'NO_TARGET_NODE' }])
  })

  it('applies the target compute policy', async () => {
    h.loadTenantVdcs.mockResolvedValue([SOURCE_VDC, { ...TARGET_VDC, computePolicy: { cpuModelMode: 'selected', cpuAllowedModels: ['x86-64-v3'], cpuDefaultModel: null, cpuAdvancedSettings: true } }])
    const { blockers } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(blockers).toEqual([{ code: 'CPU_MODEL_NOT_ALLOWED', context: { model: 'kvm64' } }])
  })

  it('reads the target CPU capabilities only in custom mode', async () => {
    h.loadTenantVdcs.mockResolvedValue([SOURCE_VDC, { ...TARGET_VDC, computePolicy: { cpuModelMode: 'custom', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: true } }])
    defaultPve({ 'conn-b /nodes/pve1-dr/capabilities/qemu/cpu': [{ name: 'standard', custom: 1 }] })
    const { blockers } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(blockers.map((b) => b.code)).toEqual(['CPU_MODEL_NOT_ALLOWED'])
    expect(h.pveFetch).toHaveBeenCalledWith({ id: 'conn-b' }, '/nodes/pve1-dr/capabilities/qemu/cpu')
  })

  it('reports the target quota violations', async () => {
    h.checkVdcQuota.mockResolvedValue({ allowed: false, violations: ['VMs: 5/5 used, cannot create additional VM'], currentUsage: {} })
    const { blockers } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(blockers).toEqual([{ code: 'QUOTA_EXCEEDED', details: ['VMs: 5/5 used, cannot create additional VM'] }])
  })

  it('refuses a storage or network outside the target vDC', async () => {
    const { blockers } = await planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, storageMap: { 'ceph-gold': 'local-lvm' }, bridgeMap: { tnet01: 'vmbr0' } })
    expect(blockers.map((b) => b.code)).toEqual(['STORAGE_NOT_IN_TARGET_VDC', 'NETWORK_NOT_IN_TARGET_VDC'])
  })

  it('refuses a live move onto a node whose QEMU does not know the running machine, not an offline one', async () => {
    defaultPve({
      'conn-a /nodes/pve1/qemu/105/status/current': { 'running-machine': 'pc-i440fx-11.1+pve0' },
      'conn-b /nodes/pve1-dr/capabilities/qemu/machines': [{ id: 'pc-i440fx-11.0+pve0' }],
    })
    const live = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(live.blockers).toEqual([{ code: 'TARGET_QEMU_TOO_OLD' }])
    expect(JSON.stringify(live.blockers)).not.toContain('pve1-dr')
    const offline = await planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, online: false })
    expect(offline.blockers).toEqual([])
    expect(offline.plan?.online).toBe(false)
  })

  it('copies offline a stopped guest even when live was asked', async () => {
    defaultPve({ 'conn-a /cluster/resources?type=vm': [{ ...SOURCE_RESOURCES[0], status: 'stopped' }] })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    expect(plan?.online).toBe(false)
  })

  it('refuses the source vDC itself as a target', async () => {
    await expect(planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, targetVdcId: 'vdc-src' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('startMove', () => {
  it('records the move, then starts remote_migrate with the per-source mappings', async () => {
    h.loadVdcMoveSettings.mockResolvedValue({ tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 100 })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    const { moveId, upid } = await startMove(plan!, TENANT)

    expect(upid).toMatch(/^UPID:/)
    expect(h.vdcMoveCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ id: moveId, tenantId: 'acme', status: 'queued', targetNode: 'pve1-dr', holder: 'replica-a', requestedBy: 'ops@acme.test' }) })
    const post = h.pveFetch.mock.calls.find((c) => String(c[1]).endsWith('/remote_migrate'))!
    const body = new URLSearchParams(post[2].body)
    expect(body.get('target-storage')).toBe('ceph-gold:nvme-gold')
    expect(body.get('target-bridge')).toBe('tnet01:tnet01')
    expect(body.get('target-vmid')).toBe('105')
    expect(body.get('online')).toBe('1')
    expect(body.get('delete')).toBe('1')
    expect(body.get('bwlimit')).toBe('102400')
    expect(h.vdcMoveUpdate).toHaveBeenCalledWith({ where: { id: moveId }, data: expect.objectContaining({ status: 'copying', upid }) })
  })

  it('shuts a running guest down before an offline copy, in the background', async () => {
    vi.useFakeTimers()
    let stopped = false
    defaultPve({
      'conn-a /nodes/pve1/qemu/105/status/shutdown': () => { stopped = true; return 'UPID:pve1:stop' },
      'conn-a /nodes/pve1/tasks/UPID%3Apve1%3Astop/status': () => ({ status: 'stopped' }),
      'conn-a /nodes/pve1/qemu/105/status/current': () => ({ status: stopped ? 'stopped' : 'running' }),
    })
    h.vdcMoveUpdateMany.mockResolvedValue({ count: 1 })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, online: false })
    expect(plan?.online).toBe(false)
    const onCopying = vi.fn()
    const res = await startMove(plan!, TENANT, 'tenant', onCopying)
    expect(res).toEqual({ moveId: expect.any(String), upid: null, stopping: true })

    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(onCopying).toHaveBeenCalledWith(res.moveId))
    const shutdown = h.pveFetch.mock.calls.find((c) => String(c[1]).endsWith('/status/shutdown'))!
    expect(Object.fromEntries(new URLSearchParams(shutdown[2].body))).toEqual({ forceStop: '1', timeout: '120' })
    const post = h.pveFetch.mock.calls.find((c) => String(c[1]).endsWith('/remote_migrate'))!
    expect(new URLSearchParams(post[2].body).get('online')).toBeNull()
    expect(h.vdcMoveUpdateMany).toHaveBeenCalled()
  })

  it('fails an offline move whose guest does not stop, without copying', async () => {
    vi.useFakeTimers()
    defaultPve({
      'conn-a /nodes/pve1/qemu/105/status/shutdown': 'UPID:pve1:stop',
      'conn-a /nodes/pve1/tasks/UPID%3Apve1%3Astop/status': { status: 'stopped' },
      'conn-a /nodes/pve1/qemu/105/status/current': { status: 'running' },
    })
    h.vdcMoveUpdateMany.mockResolvedValue({ count: 1 })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, online: false })
    await startMove(plan!, TENANT, 'tenant', vi.fn())
    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(h.vdcMoveUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', error: 'The VM did not stop' }) })))
    expect(h.pveFetch.mock.calls.some((c) => String(c[1]).endsWith('/remote_migrate'))).toBe(false)
  })

  it('fails the move and hides the Proxmox detail from a tenant when the copy cannot start', async () => {
    h.buildRemoteMigrateEndpoint.mockResolvedValue({ ok: false, error: 'node "pve1-dr" (10.42.0.111) presents another certificate' })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    const err = await startMove(plan!, TENANT).catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: 'MOVE_START_FAILED' })
    expect(err.message).not.toContain('10.42')
    expect(h.vdcMoveUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }))

    const providerErr = await startMove(plan!, PROVIDER).catch((e) => e)
    expect(providerErr.message).toContain('10.42.0.111')
  })

  it('refuses to copy a guest whose NICs changed after the checks', async () => {
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, REQUEST)
    // A NIC on a bridge of no target vDC: PVE would keep its name on the target.
    defaultPve({ 'conn-a /nodes/pve1/qemu/105/config': { ...CONFIG, net1: 'virtio=BC:24:11:00:00:02,bridge=vmbr1' } })
    const err = await startMove(plan!, TENANT).catch((e) => e)

    expect(err).toMatchObject({ status: 409, code: 'GUEST_CHANGED' })
    expect(err.message).not.toMatch(/[:(]/)
    expect(h.pveFetch.mock.calls.some((c) => String(c[1]).endsWith('/remote_migrate'))).toBe(false)
    expect(h.vdcMoveUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }))
  })

  it('reads the guest again after the shutdown and refuses a disk added meanwhile', async () => {
    vi.useFakeTimers()
    let stopped = false
    defaultPve({
      'conn-a /nodes/pve1/qemu/105/status/shutdown': () => { stopped = true; return 'UPID:pve1:stop' },
      'conn-a /nodes/pve1/tasks/UPID%3Apve1%3Astop/status': () => ({ status: 'stopped' }),
      'conn-a /nodes/pve1/qemu/105/status/current': () => ({ status: stopped ? 'stopped' : 'running' }),
      'conn-a /nodes/pve1/qemu/105/config': () => (stopped ? { ...CONFIG, scsi1: 'local-lvm:vm-105-disk-1,size=500G' } : CONFIG),
    })
    h.vdcMoveUpdateMany.mockResolvedValue({ count: 1 })
    const { plan } = await planMove(TENANT, 'conn-a', 'pve1', 105, { ...REQUEST, online: false })
    await startMove(plan!, TENANT, 'tenant', vi.fn())
    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()

    await vi.waitFor(() => expect(h.vdcMoveUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })))
    expect(h.pveFetch.mock.calls.some((c) => String(c[1]).endsWith('/remote_migrate'))).toBe(false)
  })
})

describe('recordProviderMigrationAsMove', () => {
  const INPUT = {
    sourceConnectionId: 'conn-a', sourceNode: 'pve1', vmid: 105, targetConnectionId: 'conn-b', targetNode: 'pve2-dr',
    targetVmid: 105, targetStorage: 'nvme-gold', targetBridge: 'vmbr1', online: false, deleteSource: false, upid: 'UPID:x',
  }

  it('links a guest of a vDC to the tenant vDC of the target cluster', async () => {
    const res = await recordProviderMigrationAsMove(INPUT)
    expect(res).toEqual({ moveId: expect.any(String), targetVdcName: 'Lyon' })
    expect(h.vdcMoveCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      origin: 'provider', status: 'copying', deleteSource: false, targetVdcId: 'vdc-dst',
      storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'vmbr1' },
    }) })
  })

  it('does nothing for a guest outside any vDC or a tenant without a vDC on the target', async () => {
    defaultPve({ 'conn-a /cluster/resources?type=vm': [{ ...SOURCE_RESOURCES[0], pool: undefined }] })
    expect(await recordProviderMigrationAsMove(INPUT)).toBeNull()
    defaultPve()
    expect(await recordProviderMigrationAsMove({ ...INPUT, targetConnectionId: 'conn-z' })).toBeNull()
    h.findVdcByPool.mockResolvedValue(null)
    expect(await recordProviderMigrationAsMove(INPUT)).toBeNull()
    expect(h.vdcMoveCreate).not.toHaveBeenCalled()
  })
})
