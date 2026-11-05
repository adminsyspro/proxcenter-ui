// The vDC GPU contingent on the generic paths (#672): a tenant adds no GPU
// through the hardware dialog, a clone or a restore draws on the contingent,
// the provider page reads the contingent of the VM's pool, and a tenant never
// sees a mapping that covers a GPU. A collection that could not read
// everything always refuses.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  connFindFirst: vi.fn(),
  vdcFindFirst: vi.fn(),
  getConnectionById: vi.fn(),
  getConnectionGpus: vi.fn(),
  loadVdcGpuContext: vi.fn(),
  listEntries: vi.fn(),
  pveFetch: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findFirst: m.connFindFirst }, vdc: { findFirst: m.vdcFindFirst } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: m.getConnectionById }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: m.pveFetch }))
vi.mock('@/lib/gpu/collect', () => ({ getConnectionGpus: m.getConnectionGpus }))
vi.mock('@/lib/gpu/vdcContext', () => ({ loadVdcGpuContext: m.loadVdcGpuContext }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: m.listEntries }))

import {
  archiveGpuConfig,
  archiveGpuDemand,
  cloneContingentCheck,
  contingentRefusal,
  gpuAddRefusal,
  gpuMappingIds,
  heldHostpci,
  restoreContingentCheck,
  tenantAddsGpu,
  tenantPciMappings,
  vdcContingentForVm,
} from './vdcGuard'
import { reserveVdcGpus, resetVdcPending } from './vdcPending'
import type { GpuDemand, VdcGpuEntry } from './vdcQuota'

const SRIOV = 'c1:n1:0000:03:00'
const dev = (slot: string, kind: 'gpu' | 'console', mappings: string[], extra: Record<string, unknown> = {}) => ({
  key: `c1:n1:${slot}`, connId: 'c1', node: 'n1', id: `${slot}.0`, slot, functions: [`${slot}.0`], displayFunctions: [`${slot}.0`],
  vendorId: '0x10de', deviceId: '0x2231', kind, mappings, ...extra,
})
const devices = [
  dev('0000:03:00', 'gpu', ['gpu-n1-03-00', 'vgpu-n1-03-00'], { vgpuMappings: ['vgpu-n1-03-00'], vgpu: { mode: 'sriov', virtualFunctions: [] } }),
  dev('0000:04:00', 'gpu', ['a5000']),
  dev('0000:05:00', 'console', ['bmc']),
  dev('0000:03:00', 'gpu', ['a5000-n2'], { key: 'c1:n2:0000:03:00', node: 'n2' }),
]
const clean = () => ({
  error: null,
  mappingsError: null,
  guestsError: null,
  nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: true, error: null }],
  devices,
  allocations: [],
})

const catalog = [{ deviceKey: SRIOV, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 }]
const line12q: VdcGpuEntry = { id: 'e1', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }
const q12: GpuDemand = { kind: 'vgpu', modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q' }
const alloc = (vmid: string, extra: Record<string, unknown> = {}) => ({
  vmid, kind: 'gpu', hidden: false, template: false, pool: 'vdc-a', deviceKey: SRIOV, mdev: 'nvidia-665', vendorId: '0x10de', deviceId: '0x2231', ...extra,
})
const poolGpu = (vmid: string) => ({ ...q12, vmid, template: false })
const context = (used: number, allocations: unknown[], extra: Record<string, unknown> = {}) => ({
  snapshot: clean(),
  report: { allocations, devices },
  catalog,
  entries: [line12q],
  gpus: [],
  usage: new Map([['e1', used]]),
  unresolvedVgpuModels: new Set<string>(),
  ...extra,
})
const FULL = (used: number, count: number) => ({ ok: false, code: 'quota_exhausted', used, count })
const UNAVAILABLE = { ok: false, code: 'gpu_check_unavailable' }

beforeEach(() => {
  vi.resetAllMocks()
  resetVdcPending()
  m.connFindFirst.mockResolvedValue({ id: 'c1', tenantId: 'default', name: 'PROD' })
  m.getConnectionById.mockResolvedValue({ id: 'c1' })
  m.getConnectionGpus.mockResolvedValue(clean())
  m.vdcFindFirst.mockResolvedValue({ id: 'v1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-a', enabled: true })
  m.listEntries.mockResolvedValue([line12q])
})

describe('tenantAddsGpu', () => {
  it('a hostpciN that points at a GPU adds one, read on the cached collection', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n1-03-00' }, {})).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci1: '0000:04:00,pcie=1' }, {})).toBe('adds')
    expect(m.getConnectionGpus).toHaveBeenCalledWith({ id: 'c1' }, { id: 'c1', name: 'PROD' })
    expect(m.getConnectionById).toHaveBeenCalledWith('c1', 'default')
  })

  it('a NIC, a console or a mapping of nothing adds no GPU', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: '0000:99:00', hostpci1: 'mapping=bmc', hostpci2: 'mapping=other' }, {})).toBe('none')
  })

  it('changing the options of a GPU it already holds adds none', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=a5000,pcie=1,x-vga=1' }, { hostpci0: 'mapping=a5000,pcie=1' })).toBe('none')
  })

  it('swapping the GPU or the vGPU profile of an entry counts as adding one', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n1-03-00' }, { hostpci0: 'mapping=a5000' })).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-664' }, { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' })).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n1-03-00' }, { hostpci0: '0000:99:00' })).toBe('adds')
  })

  it('a mapping of a GPU of another node counts, a raw address only on the VM node', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=a5000-n2' }, {})).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n2', { hostpci0: 'mapping=gpu-n1-03-00' }, {})).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n2', { hostpci0: '0000:04:00' }, {})).toBe('none')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=a5000-n2,pcie=1,x-vga=1' }, { hostpci0: 'mapping=a5000-n2,pcie=1' })).toBe('none')
  })

  it('a mapping known as no GPU cannot be told while a node of the cluster is not scanned', async () => {
    const n2Down = { ...clean(), nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: false, error: null }], devices: devices.filter((d) => d.node === 'n1') }
    m.getConnectionGpus.mockResolvedValue(n2Down)
    // The GPU mapping of n2 is unknown while n2 is down: it may be a GPU.
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n2-03-00' }, {})).toBe('unknown')
    // A known GPU mapping still adds; a raw address is read on the VM node; an unchanged mapping is no write.
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=a5000' }, {})).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: '0000:99:00' }, {})).toBe('none')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=nic,pcie=1' }, { hostpci0: 'mapping=nic' })).toBe('none')
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: true, error: '403' }], devices: devices.filter((d) => d.node === 'n1') })
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n2-03-00' }, {})).toBe('unknown')
  })

  it('every node scanned: a mapping that is no GPU adds none', async () => {
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=nic' }, {})).toBe('none')
  })

  it('any write over a slot whose current or pending value is a GPU counts as adding one', async () => {
    const held = { hostpci0: ['mapping=a5000,pcie=1'], hostpci1: ['0000:99:00', 'mapping=vgpu-n1-03-00,mdev=nvidia-665'] }
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=nic' }, {}, held)).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=a5000,pcie=1,x-vga=1' }, { hostpci0: 'mapping=a5000,pcie=1' }, held)).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci1: 'mapping=nic' }, { hostpci1: '0000:99:00' }, held)).toBe('adds')
    expect(await tenantAddsGpu('c1', 'n1', { hostpci2: 'mapping=nic' }, {}, held)).toBe('none')
  })

  it('reads nothing without a hostpciN written', async () => {
    expect(await tenantAddsGpu('c1', 'n1', {}, {})).toBe('none')
    expect(m.getConnectionGpus).not.toHaveBeenCalled()
  })

  it('an unreadable collection cannot tell', async () => {
    m.getConnectionGpus.mockRejectedValue(new Error('PVE 595 n1 unreachable'))
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: '0000:99:00' }, {})).toBe('unknown')
    m.connFindFirst.mockResolvedValue(null)
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: '0000:99:00' }, {})).toBe('unknown')
  })

  it('a collection that could not read the connection, the mappings or the node cannot tell', async () => {
    const nic = { hostpci0: '0000:99:00' }
    m.getConnectionGpus.mockResolvedValue({ ...clean(), error: 'ECONNREFUSED', nodes: [], devices: [] })
    expect(await tenantAddsGpu('c1', 'n1', nic, {})).toBe('unknown')
    m.getConnectionGpus.mockResolvedValue({ ...clean(), mappingsError: '403' })
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: 'mapping=gpu-n1-03-00' }, {})).toBe('unknown')
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: true, error: '403' }], devices: [] })
    expect(await tenantAddsGpu('c1', 'n1', nic, {})).toBe('unknown')
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: false, error: null }], devices: [] })
    expect(await tenantAddsGpu('c1', 'n1', nic, {})).toBe('unknown')
    expect(await tenantAddsGpu('c1', 'n9', nic, {})).toBe('unknown')
  })

  it('another node in error does not matter to a write on a clean node', async () => {
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: true, error: '403' }] })
    expect(await tenantAddsGpu('c1', 'n1', { hostpci0: '0000:99:00' }, {})).toBe('none')
  })
})

describe('cloneContingentCheck', () => {
  const source = { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' }

  it('refuses a clone whose GPUs pass the line of their profile, on a fresh read', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(2, [alloc('9020'), alloc('9021')]))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(FULL(2, 2))
    expect(m.loadVdcGpuContext).toHaveBeenCalledWith(
      { id: 'v1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-a', enabled: true },
      { refresh: true },
    )
    expect(m.vdcFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'v1' } }))
  })

  it('lets a clone through when the line has room, with what the source config holds', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(1, [alloc('9020')]))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual({ ok: true, demand: [q12] })
  })

  it('a source without GPU passes, an off-contingent GPU is refused', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(0, []))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: '0000:99:00' })).toEqual({ ok: true, demand: [] })
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: '0000:04:00' })).toEqual(FULL(0, 0))
  })

  it('counts a GPU mapping of another node the source holds', async () => {
    const whole: VdcGpuEntry = { id: 'e2', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { entries: [line12q, whole], usage: new Map([['e1', 0], ['e2', 1]]) }))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: 'mapping=a5000-n2' })).toEqual(FULL(1, 1))
  })

  it('an unreadable contingent or a partial collection cannot be checked, without the reason', async () => {
    m.loadVdcGpuContext.mockRejectedValue(new Error('vDC connection not found'))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(UNAVAILABLE)
    for (const partial of [{ guestsError: 'timeout' }, { mappingsError: '403' }, { nodes: [{ node: 'n1', online: false, error: null }] }]) {
      m.loadVdcGpuContext.mockResolvedValue(context(0, [alloc('9020')], { snapshot: { ...clean(), ...partial } }))
      expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(UNAVAILABLE)
    }
    m.vdcFindFirst.mockResolvedValue(null)
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(UNAVAILABLE)
  })

  it('a vGPU of a model whose pool vGPUs are not all resolved to a profile cannot be checked', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { unresolvedVgpuModels: new Set(['0x10de:0x2231']) }))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(UNAVAILABLE)
    // The profile of the source itself is unknown: the catalog of its card was not read.
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { catalog: [] }))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', source)).toEqual(UNAVAILABLE)
  })

  it('whole cards are judged even when a vGPU of the model is unresolved', async () => {
    const whole: VdcGpuEntry = { id: 'e2', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { entries: [whole], usage: new Map([['e2', 0]]), unresolvedVgpuModels: new Set(['0x10de:0x2231']) }))
    expect(await cloneContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: 'mapping=a5000' })).toEqual({ ok: true, demand: [{ kind: 'whole', modelKey: '0x10de:0x2231', profileName: null }] })
  })
})

describe('heldHostpci', () => {
  it('the current and the pending value of each hostpciN, with one /pending read', async () => {
    m.pveFetch.mockResolvedValue([
      { key: 'digest', value: 'd1' },
      { key: 'hostpci0', value: 'mapping=a5000', delete: 1 },
      { key: 'hostpci1', value: 'mapping=a5000', pending: 'mapping=nic' },
      { key: 'hostpci2', pending: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' },
    ])
    expect(await heldHostpci({ id: 'c1' }, 'n 1', '100')).toEqual({
      hostpci0: ['mapping=a5000'],
      hostpci1: ['mapping=a5000', 'mapping=nic'],
      hostpci2: ['mapping=vgpu-n1-03-00,mdev=nvidia-665'],
    })
    expect(m.pveFetch).toHaveBeenCalledTimes(1)
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/nodes/n%201/qemu/100/pending')
  })

  it('null when PVE cannot answer', async () => {
    m.pveFetch.mockRejectedValue(new Error('PVE 500'))
    expect(await heldHostpci({}, 'n1', '100')).toBeNull()
    m.pveFetch.mockResolvedValue({})
    expect(await heldHostpci({}, 'n1', '100')).toBeNull()
  })
})

describe('archiveGpuConfig', () => {
  it('reads the hostpciN of the backed-up config, main section only, with one call', async () => {
    m.pveFetch.mockResolvedValue('cores: 4\nhostpci0: mapping=vgpu-n1-03-00,mdev=nvidia-665\nhostpci1: 0000:99:00\n\n[snap1]\nhostpci2: mapping=a5000\n')
    expect(await archiveGpuConfig({ id: 'c1' }, 'n 1', 'pbs:backup/vm/111/2026-11-02T08:00:00Z')).toEqual({
      hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665',
      hostpci1: '0000:99:00',
    })
    expect(m.pveFetch).toHaveBeenCalledTimes(1)
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/nodes/n%201/vzdump/extractconfig?volume=pbs%3Abackup%2Fvm%2F111%2F2026-11-02T08%3A00%3A00Z')
  })

  it('null when the config cannot be read', async () => {
    m.pveFetch.mockRejectedValue(new Error('PVE 500'))
    expect(await archiveGpuConfig({}, 'n1', 'a')).toBeNull()
    m.pveFetch.mockResolvedValue({})
    expect(await archiveGpuConfig({}, 'n1', 'a')).toBeNull()
  })
})

describe('archiveGpuDemand', () => {
  it('a mapping resolves on any node, a raw address on the target node, a NIC is no GPU', () => {
    expect(archiveGpuDemand(devices as any, 'n2', {
      hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665',
      hostpci1: '0000:03:00',
      hostpci2: '0000:99:00',
      hostpci3: 'mapping=bmc',
    }, catalog)).toEqual([q12, { kind: 'whole', modelKey: '0x10de:0x2231', profileName: null }])
  })
})

describe('restoreContingentCheck', () => {
  const archive = { hostpci0: 'mapping=vgpu-n1-03-00,mdev=nvidia-665' }

  it('refuses an archive whose vGPU passes a full line', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(2, [], { gpus: [poolGpu('9020'), poolGpu('9021')] }))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, null)).toEqual(FULL(2, 2))
    expect(m.loadVdcGpuContext).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), { refresh: true })
  })

  it('restoring over the VM that holds that vGPU passes', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(2, [], { gpus: [poolGpu('9020'), poolGpu('9021')] }))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, '9020')).toEqual({ ok: true, demand: [q12] })
  })

  it('counts the clones and restores still in their task', async () => {
    reserveVdcGpus('v1', '150', [q12])
    m.loadVdcGpuContext.mockResolvedValue(context(1, [], { gpus: [poolGpu('9020')] }))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, null)).toEqual(FULL(2, 2))
  })

  it('an archive without GPU needs no collection', async () => {
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: '0000:99:00' }, null)).toEqual({ ok: true, demand: [] })
    expect(m.loadVdcGpuContext).not.toHaveBeenCalled()
    m.getConnectionGpus.mockResolvedValue({ ...clean(), guestsError: 'timeout' })
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', { hostpci0: '0000:99:00' }, null)).toEqual({ ok: true, demand: [] })
  })

  it('a partial or unreadable collection cannot be checked', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { snapshot: { ...clean(), mappingsError: '403' } }))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, null)).toEqual(UNAVAILABLE)
    m.loadVdcGpuContext.mockRejectedValue(new Error('boom'))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, null)).toEqual(UNAVAILABLE)
  })

  it('a vGPU of a model with an unresolved pool vGPU cannot be checked', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(0, [], { unresolvedVgpuModels: new Set(['0x10de:0x2231']) }))
    expect(await restoreContingentCheck('v1', 'c1', 'vdc-a', 'n1', archive, null)).toEqual(UNAVAILABLE)
  })
})

describe('vdcContingentForVm', () => {
  it('the contingent of the vDC whose pool holds the VM, on a fresh read', async () => {
    m.loadVdcGpuContext.mockResolvedValue(context(1, []))
    const r = await vdcContingentForVm('c1', 'vdc-a', { refresh: false })
    expect(r).toEqual({ vdcId: 'v1', entries: [line12q], usage: new Map([['e1', 1]]), catalog, unresolvedVgpuModels: new Set() })
    expect(m.vdcFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: 'c1', pvePoolName: 'vdc-a' } }))
    expect(m.loadVdcGpuContext).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), { refresh: false })
  })

  it('null without a pool, for a pool of no vDC, or a vDC without a line', async () => {
    expect(await vdcContingentForVm('c1', null, { refresh: false })).toBeNull()
    expect(m.vdcFindFirst).not.toHaveBeenCalled()
    m.vdcFindFirst.mockResolvedValueOnce(null)
    expect(await vdcContingentForVm('c1', 'other', { refresh: false })).toBeNull()
    m.listEntries.mockResolvedValueOnce([])
    expect(await vdcContingentForVm('c1', 'vdc-a', { refresh: false })).toBeNull()
    expect(m.loadVdcGpuContext).not.toHaveBeenCalled()
  })
})

describe('gpuAddRefusal', () => {
  it('adds: 409 gpu_via_my_vdc; unknown: 503 gpu_check_unavailable; none: no refusal', async () => {
    const adds = gpuAddRefusal('adds')!
    expect(adds.status).toBe(409)
    expect(await adds.json()).toEqual({ error: 'gpu_via_my_vdc' })
    const unknown = gpuAddRefusal('unknown')!
    expect(unknown.status).toBe(503)
    expect(await unknown.json()).toEqual({ error: 'gpu_check_unavailable' })
    expect(gpuAddRefusal('none')).toBeNull()
  })
})

describe('contingentRefusal', () => {
  it('answers quota_exhausted 409 with the use, or gpu_check_unavailable 503', async () => {
    const full = contingentRefusal({ ok: false, code: 'quota_exhausted', used: 2, count: 2 })
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'quota_exhausted', used: 2, count: 2 })
    const unavailable = contingentRefusal({ ok: false, code: 'gpu_check_unavailable' })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: 'gpu_check_unavailable' })
  })
})

describe('gpuMappingIds', () => {
  it('every mapping and vGPU mapping of a GPU, never one of a console', async () => {
    expect(await gpuMappingIds('c1')).toEqual(new Set(['gpu-n1-03-00', 'vgpu-n1-03-00', 'a5000', 'a5000-n2']))
    expect(m.getConnectionGpus).toHaveBeenCalledWith({ id: 'c1' }, { id: 'c1', name: 'PROD' })
  })
})

describe('tenantPciMappings', () => {
  const nic = { id: 'nic-x710', map: ['node=n1,path=0000:99:00,id=8086:1572'] }
  const listed = [{ id: 'gpu-n1-03-00', map: ['node=n1,path=0000:03:00'] }, nic, { id: 'nic-n2', map: ['node=n2,path=0000:99:00'] }]

  it('drops the mappings that cover a GPU', async () => {
    expect(await tenantPciMappings('c1', listed)).toEqual([nic, listed[2]])
  })

  it('withholds a mapping that names a node not scanned cleanly', async () => {
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: true, error: '403' }] })
    expect(await tenantPciMappings('c1', listed)).toEqual([nic])
    m.getConnectionGpus.mockResolvedValue({ ...clean(), nodes: [{ node: 'n1', online: true, error: null }, { node: 'n2', online: false, error: null }] })
    expect(await tenantPciMappings('c1', listed)).toEqual([nic])
  })

  it('withholds every mapping when the connection or the mappings could not be read', async () => {
    m.getConnectionGpus.mockResolvedValue({ ...clean(), error: 'ECONNREFUSED' })
    expect(await tenantPciMappings('c1', listed)).toEqual([])
    m.getConnectionGpus.mockResolvedValue({ ...clean(), mappingsError: '403' })
    expect(await tenantPciMappings('c1', listed)).toEqual([])
    m.getConnectionGpus.mockRejectedValue(new Error('boom'))
    expect(await tenantPciMappings('c1', listed)).toEqual([])
  })
})
