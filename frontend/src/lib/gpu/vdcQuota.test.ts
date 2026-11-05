import { describe, expect, it } from 'vitest'

import type { VisibleVgpuType } from './metricsShared'
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from './report'
import { checkDemand, entryUsage, matchEntry, modelKeyOf, poolGpus, quotaCapacity, quotaOffers, unresolvedVgpuModelsOf, type VdcGpuEntry } from './vdcQuota'

const SRIOV = 'c1:n1:0000:03:00'
const WHOLE = 'c1:n1:0000:04:00'

const catalog: VisibleVgpuType[] = [
  { deviceKey: SRIOV, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
  { deviceKey: SRIOV, typeId: 664, name: 'RTXA5000-8Q', fbMemory: 8192, maxInstances: 3 },
  { deviceKey: SRIOV, typeId: 660, name: 'RTXA5000-4B', fbMemory: 4096, maxInstances: 6 },
]

const device = (key: string, slot: string, sriov: boolean): GpuReportDevice => ({
  key, connId: 'c1', node: 'n1', id: `${slot}.0`, slot, functions: [`${slot}.0`], displayFunctions: [`${slot}.0`],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA Corporation', deviceName: 'GA102GL [RTX A5000]', subsystemName: null,
  classCode: '0x030200', iommuGroup: 1, iommuIsolated: true, mdev: sriov,
  vgpu: sriov ? { mode: 'sriov', virtualFunctions: [] } : null,
  kind: 'gpu', consoleReason: null, mappings: [], connectionName: 'PROD', vms: [],
})

const alloc = (vmid: string, status: string, pool: string, deviceKey: string, extra: Partial<GpuReportAllocation> = {}): GpuReportAllocation => ({
  connId: 'c1', connectionName: 'PROD', node: 'n1', vmid, vmName: `vm-${vmid}`, vmStatus: status, template: false, hidden: false,
  hostpci: 'hostpci0', via: 'address', mapping: null, mdev: null, pooled: false, pool, uptime: null, smbiosUuid: `uuid-${vmid}`, pendingRemoval: false,
  kind: 'gpu', vendorName: null, deviceName: null, vendorId: '0x10de', deviceId: '0x2231', deviceKey, pciId: null, ...extra,
})

function report(): GpuReport {
  return {
    scope: 'infrastructure', generatedAt: '2026-11-02T08:00:00.000Z',
    connections: [{ id: 'c1', name: 'PROD', error: null, capacity: null }],
    nodes: [],
    devices: [device(SRIOV, '0000:03:00', true), device(WHOLE, '0000:04:00', false)],
    allocations: [
      alloc('9020', 'running', 'vdc-p', SRIOV, { mdev: 'nvidia-665' }),
      alloc('9021', 'stopped', 'vdc-p', SRIOV, { mdev: 'nvidia-665' }),
      alloc('9022', 'stopped', 'vdc-p', SRIOV, { mdev: 'nvidia-665', template: true }),
      alloc('9023', 'running', 'vdc-p', WHOLE),
      alloc('9030', 'running', 'autre', SRIOV, { mdev: 'nvidia-664' }),
    ],
    capacity: null,
  }
}

const entry = (id: string, kind: 'vgpu' | 'whole', profile: string, count: number): VdcGpuEntry => ({
  id, kind, modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: profile, count,
})
const vgpu12 = entry('e1', 'vgpu', 'RTXA5000-12Q', 2)
const whole = entry('e2', 'whole', '', 1)

describe('modelKeyOf', () => {
  it('lower-cases vendor and device IDs', () => {
    expect(modelKeyOf({ vendorId: '0x10DE', deviceId: '0x2231' })).toBe('0x10de:0x2231')
    expect(modelKeyOf({ vendorId: null, deviceId: null })).toBe('?:?')
  })
})

describe('poolGpus', () => {
  it("returns only the pool's GPUs with resolved profile names", () => {
    const gpus = poolGpus(report(), 'vdc-p', catalog)
    expect(gpus).toHaveLength(4)
    expect(gpus[0]).toMatchObject({ vmid: '9020', kind: 'vgpu', modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q', mdev: 'nvidia-665', template: false })
    expect(gpus[2]).toMatchObject({ vmid: '9022', template: true })
    expect(gpus[3]).toMatchObject({ vmid: '9023', kind: 'whole', profileName: null, mdev: null })
  })

  it('carries the pending removal of a GPU, which stays counted', () => {
    const r = report()
    r.allocations[0] = alloc('9020', 'running', 'vdc-p', SRIOV, { mdev: 'nvidia-665', pendingRemoval: true })
    const gpus = poolGpus(r, 'vdc-p', catalog)
    expect(gpus.map((g) => g.pendingRemoval)).toEqual([true, false, false, false])
    expect(entryUsage([vgpu12], gpus).get('e1')).toBe(2)
  })

  it('skips hidden allocations, consoles and allocations without device or VM', () => {
    const r = report()
    r.allocations.push(
      alloc('9040', 'running', 'vdc-p', SRIOV, { hidden: true }),
      alloc('9041', 'running', 'vdc-p', SRIOV, { kind: 'console' }),
      alloc('9042', 'running', 'vdc-p', SRIOV, { vmid: null }),
      alloc('9043', 'running', 'vdc-p', null as unknown as string),
    )
    expect(poolGpus(r, 'vdc-p', catalog).map((g) => g.vmid)).toEqual(['9020', '9021', '9022', '9023'])
  })
})

describe('unresolvedVgpuModelsOf', () => {
  // Two SR-IOV cards of one model; the host of the second missed this round of the catalog.
  const OTHER = 'c1:n2:0000:03:00'
  const twoCards = (): GpuReport => ({
    ...report(),
    devices: [device(SRIOV, '0000:03:00', true), { ...device(OTHER, '0000:03:00', true), node: 'n2' }],
    allocations: [
      alloc('9020', 'running', 'vdc-p', SRIOV, { mdev: 'nvidia-665' }),
      alloc('9030', 'running', 'vdc-p', OTHER, { mdev: 'nvidia-665', node: 'n2' }),
      alloc('9031', 'running', 'vdc-p', OTHER, { mdev: 'nvidia-665', node: 'n2' }),
    ],
  })
  const line: VdcGpuEntry = { id: 'e', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }

  it('names the model of the vGPUs whose card has no catalog: their line use is a floor only', () => {
    const gpus = poolGpus(twoCards(), 'vdc-p', catalog)
    expect(gpus.map((g) => g.profileName)).toEqual(['RTXA5000-12Q', null, null])
    // Without the guard the line reads 1 of 2 used while three vGPUs run.
    expect(entryUsage([line], gpus).get('e')).toBe(1)
    expect(unresolvedVgpuModelsOf(gpus)).toEqual(new Set(['0x10de:0x2231']))
  })

  it('nothing when every vGPU resolves; templates and whole cards never count', () => {
    expect(unresolvedVgpuModelsOf(poolGpus(report(), 'vdc-p', catalog))).toEqual(new Set())
    expect(unresolvedVgpuModelsOf([
      { kind: 'vgpu', modelKey: 'b', profileName: null, template: true },
      { kind: 'whole', modelKey: 'c', profileName: null, template: false },
    ])).toEqual(new Set())
  })
})

describe('entryUsage', () => {
  it('counts stopped VMs and skips templates', () => {
    const gpus = poolGpus(report(), 'vdc-p', catalog)
    const usage = entryUsage([vgpu12, whole], gpus)
    expect(usage.get('e1')).toBe(2)
    expect(usage.get('e2')).toBe(1)
  })

  it('a GPU matching no entry is off-contingent and counted nowhere', () => {
    const gpus = poolGpus(report(), 'vdc-p', catalog)
    expect(matchEntry([whole], gpus[0])).toBeNull()
    expect(entryUsage([whole], gpus).get('e2')).toBe(1)
  })
})

describe('checkDemand', () => {
  const usage = () => entryUsage([vgpu12], poolGpus(report(), 'vdc-p', catalog))
  const demand12 = [{ kind: 'vgpu' as const, modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q' }]

  it('refuses past the count', () => {
    expect(checkDemand([vgpu12], usage(), demand12)).toEqual({ ok: false, entryId: 'e1', used: 2, count: 2 })
    expect(checkDemand([{ ...vgpu12, count: 3 }], usage(), demand12)).toEqual({ ok: true })
  })

  it('counts the demand lines against each other', () => {
    expect(checkDemand([{ ...vgpu12, count: 3 }], usage(), [...demand12, ...demand12])).toMatchObject({ ok: false, entryId: 'e1', used: 3, count: 3 })
  })

  it('refuses an off-contingent demand', () => {
    const d8 = [{ kind: 'vgpu' as const, modelKey: '0x10de:0x2231', profileName: 'RTXA5000-8Q' }]
    expect(checkDemand([vgpu12], usage(), d8)).toEqual({ ok: false, entryId: null, used: 0, count: 0 })
  })

  it('an entry lowered under what is held stays over-committed', () => {
    expect(checkDemand([{ ...vgpu12, count: 1 }], usage(), demand12)).toEqual({ ok: false, entryId: 'e1', used: 2, count: 1 })
  })
})

describe('quotaOffers', () => {
  it('lists profiles of SR-IOV cards and whole models', () => {
    const offers = quotaOffers(report(), catalog, 'c1')
    // the 32 GiB promised on the card (two 12Q, one 8Q) exceed its frame buffer: nothing is free
    expect(offers).toContainEqual({ kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'GA102GL [RTX A5000]', profileName: 'RTXA5000-8Q', fbMemory: 8192, freeNow: 0 })
    expect(offers).toContainEqual({ kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'GA102GL [RTX A5000]', profileName: '', fbMemory: null, freeNow: 0 })
    const names = offers.filter((o) => o.kind === 'vgpu').map((o) => o.profileName)
    expect(names).toEqual(['RTXA5000-8Q', 'RTXA5000-12Q', 'RTXA5000-4B'])
  })

  it('counts a whole card with no allocation as free and ignores other connections', () => {
    const r = report()
    r.allocations = r.allocations.filter((a) => a.vmid !== '9023')
    expect(quotaOffers(r, catalog, 'c1').find((o) => o.kind === 'whole')?.freeNow).toBe(1)
    expect(quotaOffers(r, catalog, 'c2')).toEqual([])
  })
})

describe('quotaCapacity', () => {
  it('adds up the frame buffer of SR-IOV cards and counts whole cards per model', () => {
    expect(quotaCapacity(report(), catalog, 'c1')).toEqual([
      { modelKey: '0x10de:0x2231', modelName: 'GA102GL [RTX A5000]', fbTotal: 12288, wholeCards: 1, partial: false },
    ])
    expect(quotaCapacity(report(), catalog, 'c2')).toEqual([])
  })

  it('flags a model whose SR-IOV card was not read', () => {
    const r = report()
    r.devices.push(device('c1:n1:0000:05:00', '0000:05:00', true))
    const [cap] = quotaCapacity(r, catalog, 'c1')
    expect(cap).toMatchObject({ fbTotal: 12288, partial: true })
  })
})
