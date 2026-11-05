import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ report: vi.fn(), feature: vi.fn(), latest: vi.fn(), settings: vi.fn() }))
vi.mock('@/lib/gpu/visibleReport', () => ({ loadVisibleGpuReport: () => m.report() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: () => m.feature() }))
vi.mock('@/lib/gpu/metrics', async orig => ({
  ...(await orig<typeof import('@/lib/gpu/metrics')>()),
  getGpuMetricsLatest: () => m.latest(),
  getGpuMetricsSettings: () => m.settings(),
}))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn(), parseOrchestratorError: () => null }))

import { getGpusTool } from './gpus'

const dev = (slot: string, name: string, vms: any[] = [], conn = 'LAB') => ({
  key: `c1:n1:${slot}`, connId: 'c1', node: 'n1', id: `${slot}.0`, slot, functions: [], displayFunctions: [], vendorId: '0x10de', deviceId: name === 'L4' ? '0x27b8' : '0x2231',
  vendorName: 'NVIDIA', deviceName: name, subsystemName: null, classCode: '0x030000', iommuGroup: 1, iommuIsolated: true, mdev: false, kind: 'gpu', consoleReason: null, mappings: [], connectionName: conn, vms,
})
const holder = { vmid: '9010', vmName: 'ai', vmStatus: 'running', hidden: false, template: false, hostpci: 'hostpci0', via: 'mapping', mdev: null, pooled: false }
const REPORT = {
  scope: 'infrastructure', generatedAt: '', nodes: [], capacity: { total: 2, allocated: 1, free: 1, inUse: 1, consoles: 0 },
  connections: [{ id: 'c1', name: 'LAB', error: null, capacity: null }],
  devices: [dev('0000:03:00', 'RTX A5000', [holder]), dev('0000:41:00', 'L4')],
  allocations: [{ connId: 'c1', connectionName: 'LAB', node: 'n1', vmid: '9010', vmName: 'ai', vmStatus: 'running', template: false, hidden: false, hostpci: 'hostpci0', via: 'mapping', mapping: 'm', mdev: null, pooled: false, pool: null, uptime: 1, kind: 'gpu', vendorName: 'NVIDIA', deviceName: 'RTX A5000', vendorId: '0x10de', deviceId: '0x2231', deviceKey: 'c1:n1:0000:03:00', pciId: '0000:03:00.0' }],
}
const reading = { connection_id: 'c1', target: 'vm:9010:GPU-a', source: 'guest', node: 'n1', vmid: 9010, index: 0, uuid: 'GPU-a', name: 'RTX A5000', bus_id: '0000:01:00', at: '', util: 96, mem_util: 0, mem_used: 23000, mem_total: 24564, temp: 70, power: 229, power_limit: 230, thermal_slow: false, power_slow: true }

beforeEach(() => {
  m.report.mockResolvedValue(REPORT)
  m.feature.mockResolvedValue(true)
  m.latest.mockResolvedValue({ at: '', gpus: [reading], probes: [] })
  m.settings.mockResolvedValue({ thresholds: { util_pct: 90, memory_pct: 90, temp_c: 85 } })
})

const run = (args: Record<string, unknown> = {}) => getGpusTool.execute(args, {} as any) as Promise<any>

describe('get_gpus', () => {
  it('lists every GPU with its holder, live load and pressure, and the free ones per model', async () => {
    const r = await run()
    expect(r.loadMeasured).toBe(true)
    expect(r.byModel).toEqual(expect.arrayContaining([expect.objectContaining({ model: 'L4', total: 1, free: 1 })]))
    const a5000 = r.gpus.find((g: any) => g.model === 'RTX A5000')
    expect(a5000).toEqual(expect.objectContaining({ status: 'in_use', loadPct: 96, memoryUsedPct: 94, pressure: ['saturated', 'memoryPressure', 'throttled'] }))
    expect(a5000.vms).toEqual([{ name: 'ai', vmid: '9010', status: 'running' }])
    expect(r.gpus.find((g: any) => g.model === 'L4')).toEqual(expect.objectContaining({ status: 'free', measured: false }))
  })

  it('narrows by free, pressure, model and cluster without any Proxmox call', async () => {
    expect((await run({ free_only: true })).gpus.map((g: any) => g.model)).toEqual(['L4'])
    expect((await run({ pressure_only: true })).gpus.map((g: any) => g.model)).toEqual(['RTX A5000'])
    expect((await run({ model: 'l4' })).gpus).toHaveLength(1)
    expect((await run({ cluster: 'other' })).gpus).toHaveLength(0)
  })

  it('answers from the inventory alone without the licence or the orchestrator', async () => {
    m.feature.mockResolvedValue(false)
    expect((await run()).loadMeasured).toBe(false)
    m.feature.mockResolvedValue(true)
    m.latest.mockRejectedValue(new Error('down'))
    const r = await run()
    expect(r.loadMeasured).toBe(false)
    expect(r.gpus[0].measured).toBe(false)
  })

  it('tells a vDC tenant nothing about GPUs', async () => {
    m.report.mockResolvedValue({ ...REPORT, scope: 'tenant', devices: [] })
    expect(await run()).toEqual({ unavailable: 'GPU information is not available to a vDC tenant.' })
  })
})

describe('get_gpus on a card in vGPU mode', () => {
  it('lists its vGPUs with their profile and share, and the profiles it can still take', async () => {
    const card = { ...dev('0000:03:00', 'RTX A5000', [{ ...holder, mdev: 'nvidia-665' }]), mdev: true, vgpu: { mode: 'sriov', virtualFunctions: ['0000:03:00.4'] } }
    const alloc = { ...REPORT.allocations[0], mdev: 'nvidia-665', via: 'mapping', smbiosUuid: 'aaf01d24-083c-4653-9644-e5840a3ad870' }
    m.report.mockResolvedValue({ ...REPORT, devices: [card], allocations: [alloc] })
    m.latest.mockResolvedValue({
      at: '',
      gpus: [],
      probes: [],
      vgpus: [{ connection_id: 'c1', node: 'n1', bus_id: '0000:03:00', id: '1', vm_uuid: 'aaf01d24-083c-4653-9644-e5840a3ad870', vm_name: 'ai', type_id: 665, type_name: 'RTXA5000-12Q', fb_total: 12288, fb_used: 10240, util: 59, mem_util: 40, licensed: true, license: 'Licensed', guest_driver: '595.112.07', at: '' }],
      vgpu_types: [
        { connection_id: 'c1', node: 'n1', bus_id: '0000:03:00', type_id: 664, name: 'RTXA5000-8Q', class: 'Quadro', fb_memory: 8192, max_instances: 3 },
        { connection_id: 'c1', node: 'n1', bus_id: '0000:03:00', type_id: 665, name: 'RTXA5000-12Q', class: 'Quadro', fb_memory: 12288, max_instances: 2 },
        { connection_id: 'c1', node: 'n1', bus_id: '0000:03:00', type_id: 666, name: 'RTXA5000-24Q', class: 'Quadro', fb_memory: 24576, max_instances: 1 },
      ],
    })
    const r = await run()
    const gpu = r.gpus[0]
    expect(gpu.status).toBe('vgpu')
    expect(gpu.vgpus).toEqual([{ vm: 'ai', vmid: '9010', status: 'running', profile: '12Q', memoryGiB: 12, memoryUsedGiB: 10, shareOfCardPct: 59, licensed: true }])
    expect(gpu.vgpuMemory).toEqual({ totalGiB: 24, promisedGiB: 12, freeGiB: 12 })
    // 12 of 24 GiB promised: one more 8Q or 12Q, no 24Q.
    expect(gpu.profilesStillPossible).toEqual([
      { profile: '8Q', memoryGiB: 8, stillPossible: 1 },
      { profile: '12Q', memoryGiB: 12, stillPossible: 1 },
      { profile: '24Q', memoryGiB: 24, stillPossible: 0 },
    ])
  })
})
