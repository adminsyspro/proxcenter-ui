import { describe, expect, it } from 'vitest'

import { visibleLatest } from './metrics'
import type { OrchestratorSnapshot } from './metricsShared'
import type { GpuReport } from './report'
import type { VdcGpuContext } from './vdcContext'
import { entryUsage, unresolvedVgpuModelsOf, poolGpus, type VdcGpuEntry } from './vdcQuota'
import { buildMyGpuView } from './vdcView'

const NODE = 'pve9-a5000'
const CONN = 'PVE9-A5000'
const MAPPING = 'gpu-pve9-a5000-03-00-vgpu'
const A5000 = `c1:${NODE}:0000:03:00`
const L40S_A = `c1:${NODE}:0000:04:00`
const L40S_B = `c1:${NODE}:0000:05:00`
const UUID = 'b3f1c0de-1111-2222-3333-444455556666'
const AT = '2026-11-02T10:00:00Z'

const device = (key: string, slot: string, deviceId: string, deviceName: string, vgpu: unknown) => ({
  key, connId: 'c1', node: NODE, id: `${slot}.0`, slot, functions: [], displayFunctions: [],
  vendorId: '0x10de', deviceId, vendorName: 'NVIDIA', deviceName, subsystemName: 'NVIDIA Corp', classCode: '0x030000',
  iommuGroup: 35, iommuIsolated: true, mdev: !!vgpu, kind: 'gpu', consoleReason: null, mappings: [MAPPING], connectionName: CONN,
  vgpu, vms: [],
})

const alloc = (vmid: string, over: Record<string, unknown> = {}) => ({
  connId: 'c1', connectionName: CONN, node: NODE, vmid, vmName: `vm-${vmid}`, vmStatus: 'running', template: false, hidden: false,
  hostpci: 'hostpci0', via: 'mapping', mapping: MAPPING, mdev: 'nvidia-1', pooled: true, pool: 'vdc-p', uptime: 100,
  smbiosUuid: null, pendingRemoval: false, kind: 'gpu', vendorName: 'NVIDIA', deviceName: 'GA102GL [RTX A5000]', vendorId: '0x10de', deviceId: '0x2231',
  deviceKey: A5000, pciId: '0000:03:00.4', ...over,
})

const whole = (vmid: string, key: string, over: Record<string, unknown> = {}) =>
  alloc(vmid, { mdev: null, deviceKey: key, deviceName: 'AD102GL [L40S]', deviceId: '0x26b9', pciId: `${key.slice(-10)}.0`, ...over })

function report(allocations: unknown[]): GpuReport {
  return {
    scope: 'infrastructure',
    generatedAt: AT,
    connections: [{ id: 'c1', name: CONN, error: null, capacity: null }],
    nodes: [{ connId: 'c1', node: NODE, connectionName: CONN } as any],
    devices: [
      device(A5000, '0000:03:00', '0x2231', 'GA102GL [RTX A5000]', { mode: 'sriov' }),
      device(L40S_A, '0000:04:00', '0x26b9', 'AD102GL [L40S]', null),
      device(L40S_B, '0000:05:00', '0x26b9', 'AD102GL [L40S]', null),
    ] as any,
    allocations: allocations as any,
    capacity: null,
  }
}

const orchestrator: OrchestratorSnapshot = {
  at: AT,
  gpus: [
    {
      connection_id: 'c1', target: 'vm:9030:0', source: 'guest', node: NODE, vmid: 9030, index: 0, uuid: 'GPU-1', name: 'NVIDIA L40S',
      bus_id: '00000000:01:00.0', at: AT, util: 48, mem_util: 30, mem_used: 9000, mem_total: 46068, temp: 50, power: 100, power_limit: 350,
      thermal_slow: false, power_slow: false,
    },
  ],
  probes: [],
  vgpus: [
    {
      connection_id: 'c1', node: NODE, bus_id: '00000000:03:00.0', id: '1', vm_uuid: UUID.toUpperCase(), vm_name: 'vm-9020', type_id: 1,
      type_name: 'RTXA5000-12Q', fb_total: 12288, fb_used: 2048, util: 35, mem_util: 12, licensed: true, license: 'ok', guest_driver: '550', at: AT,
    },
  ],
  vgpu_types: [
    { connection_id: 'c1', node: NODE, bus_id: '0000:03:00', type_id: 1, name: 'RTXA5000-12Q', class: 'Quadro', fb_memory: 12288, max_instances: 2 },
  ],
}

const entries: VdcGpuEntry[] = [
  { id: 'e-vgpu', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 },
  { id: 'e-whole', kind: 'whole', modelKey: '0x10de:0x26b9', modelName: 'L40S', profileName: '', count: 1 },
]

const ALLOCATIONS = [
  alloc('9020', { smbiosUuid: UUID }),
  alloc('9021', { smbiosUuid: 'c0ffee00-0000-0000-0000-000000000001' }),
  whole('9030', L40S_A),
  whole('9040', L40S_B, { vmStatus: 'stopped', uptime: null }),
  alloc('9900', { template: true, vmStatus: 'stopped' }),
  alloc('7000', { pool: 'vdc-other', vmName: 'other-customer', smbiosUuid: 'c0ffee00-0000-0000-0000-000000000002' }),
]

function context(opts: { measured?: boolean; allocations?: unknown[]; snap?: OrchestratorSnapshot } = {}): VdcGpuContext {
  const r = report(opts.allocations ?? ALLOCATIONS)
  const latest = opts.measured === false ? null : visibleLatest(r, opts.snap ?? orchestrator)
  const catalog = latest?.vgpuTypes ?? []
  const gpus = poolGpus(r, 'vdc-p', catalog)
  return { conn: {}, snapshot: {} as any, report: r, catalog, latest, entries, gpus, usage: entryUsage(entries, gpus), unresolvedVgpuModels: unresolvedVgpuModelsOf(gpus) }
}

const gpuOf = (view: ReturnType<typeof buildMyGpuView>, vmid: string) => view.vms.find((v) => v.vmid === vmid)?.gpus[0]

describe('buildMyGpuView', () => {
  it('the view carries no infrastructure name', () => {
    const json = JSON.stringify(buildMyGpuView(context(), null))
    for (const name of [NODE, MAPPING, CONN, 'other-customer', '0000:03:00', 'c1:']) expect(json).not.toContain(name)
    for (const key of ['node', 'deviceKey', 'pciId', 'mapping', 'connId', 'connectionId', 'connectionName', 'smbiosUuid', 'mdev']) {
      expect(json).not.toContain(`"${key}"`)
    }
  })

  it('lists the lines with their use, the frame buffer of vGPU profiles and an overcommit flag', () => {
    const view = buildMyGpuView(context(), null)
    expect(view.entries).toEqual([
      { id: 'e-vgpu', kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', fbMemory: 12288, count: 2, used: 2, overCommitted: false },
      { id: 'e-whole', kind: 'whole', modelName: 'L40S', profileName: '', fbMemory: null, count: 1, used: 2, overCommitted: true },
    ])
    expect(view.measured).toBe(true)
    expect(view.generatedAt).toBe(AT)
  })

  it('lists the VMs of the pool with GPUs, never a template nor another pool', () => {
    const view = buildMyGpuView(context(), null)
    expect(view.vms.map((v) => v.vmid)).toEqual(['9020', '9021', '9030', '9040'])
    expect(view.vms[0]).toMatchObject({ vmid: '9020', name: 'vm-9020', status: 'running' })
  })

  it('vGPU load comes from the host reading by SMBIOS UUID', () => {
    const view = buildMyGpuView(context(), null)
    expect(gpuOf(view, '9020')).toEqual({
      hostpci: 'hostpci0', kind: 'vgpu', modelName: 'GA102GL [RTX A5000]', profileName: 'RTXA5000-12Q', entryId: 'e-vgpu',
      pendingStart: false, pendingRemoval: false, load: { util: 35, memUtil: 12, fbUsed: 2048, fbTotal: 12288, at: AT }, licensed: true,
    })
  })

  it('a whole card uses the guest reading, null when not measured', () => {
    const view = buildMyGpuView(context(), null)
    expect(gpuOf(view, '9030')).toMatchObject({
      kind: 'whole', modelName: 'AD102GL [L40S]', profileName: null, entryId: 'e-whole',
      load: { util: 48, memUtil: 30, fbUsed: 9000, fbTotal: 46068, at: AT }, licensed: null, pendingStart: false,
    })
    expect(gpuOf(view, '9040')).toMatchObject({ kind: 'whole', entryId: 'e-whole', load: null, licensed: null, pendingStart: false })
  })

  it('pendingRemoval marks a GPU released from a running VM, still counted on its line', () => {
    const view = buildMyGpuView(context({ allocations: [alloc('9020', { smbiosUuid: UUID, pendingRemoval: true }), alloc('9021')] }), null)
    expect(gpuOf(view, '9020')).toMatchObject({ pendingRemoval: true })
    expect(gpuOf(view, '9021')).toMatchObject({ pendingRemoval: false })
    expect(view.entries.find((e) => e.id === 'e-vgpu')?.used).toBe(2)
  })

  it('pendingStart marks a running VM whose vGPU the host does not show, only when measured', () => {
    expect(gpuOf(buildMyGpuView(context(), null), '9021')).toMatchObject({ pendingStart: true, load: null, licensed: null })
    expect(gpuOf(buildMyGpuView(context({ measured: false }), null), '9021')).toMatchObject({ pendingStart: false })
    const stopped = context({ allocations: [alloc('9021', { vmStatus: 'stopped' })] })
    expect(gpuOf(buildMyGpuView(stopped, null), '9021')).toMatchObject({ pendingStart: false })
  })

  it('pendingStart stays false on a card whose host is not read', () => {
    const view = buildMyGpuView(context({ snap: { ...orchestrator, vgpus: [], vgpu_types: [] } }), null)
    expect(view.measured).toBe(true)
    expect(gpuOf(view, '9021')).toMatchObject({ pendingStart: false })
  })

  it('VMs the tenant may not view are left out', () => {
    const view = buildMyGpuView(context(), new Set(['9030']))
    expect(view.vms.map((v) => v.vmid)).toEqual(['9030'])
    expect(view.entries.find((e) => e.id === 'e-vgpu')?.used).toBe(2)
  })

  it('no catalog: measured false and vGPU entryId null', () => {
    const view = buildMyGpuView(context({ measured: false }), null)
    expect(view.measured).toBe(false)
    expect(gpuOf(view, '9020')).toMatchObject({ kind: 'vgpu', profileName: null, entryId: null, load: null, pendingStart: false })
    expect(gpuOf(view, '9030')).toMatchObject({ entryId: 'e-whole', load: null })
    expect(view.entries[0]).toMatchObject({ id: 'e-vgpu', fbMemory: null, used: 0 })
  })

  it('a VM with two GPUs lists them in hostpci order', () => {
    const view = buildMyGpuView(context({ allocations: [whole('9050', L40S_B, { hostpci: 'hostpci1' }), whole('9050', L40S_A)] }), null)
    expect(view.vms).toHaveLength(1)
    expect(view.vms[0].gpus.map((g) => g.hostpci)).toEqual(['hostpci0', 'hostpci1'])
  })
})
