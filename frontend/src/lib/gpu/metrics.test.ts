import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn(), parseOrchestratorError: vi.fn(() => null) }))

import { isGpuRange, readingPerDevice, targetResolver, visibleLatest, visibleSeries, visibleVgpus, type OrchestratorGpu, type OrchestratorSeriesPoint, type OrchestratorVgpu } from './metrics'
import type { GpuReport, GpuReportAllocation } from './report'

const alloc = (over: Partial<GpuReportAllocation>): GpuReportAllocation => ({
  connId: 'c1',
  connectionName: 'PROD',
  node: 'n1',
  vmid: '9010',
  vmName: 'ai',
  vmStatus: 'running',
  template: false,
  hidden: false,
  hostpci: 'hostpci0',
  via: 'address',
  mapping: null,
  mdev: null,
  pooled: false,
  pool: null,
  uptime: 60, smbiosUuid: null, pendingRemoval: false,
  kind: 'gpu',
  vendorName: 'NVIDIA',
  deviceName: 'GA102GL [RTX A5000]',
  vendorId: '0x10de',
  deviceId: '0x2231',
  deviceKey: 'c1:n1:0000:03:00',
  pciId: '0000:03:00.0',
  ...over,
})

const report: GpuReport = {
  scope: 'infrastructure',
  generatedAt: '',
  connections: [{ id: 'c1', name: 'PROD', error: null, capacity: null }],
  nodes: [{ node: 'n1', online: true, error: null, connId: 'c1', connectionName: 'PROD', capacity: { total: 2, allocated: 2, free: 0, inUse: 1, consoles: 0 } }],
  devices: [
    {
      key: 'c1:n1:0000:41:00', connId: 'c1', node: 'n1', id: '0000:41:00.0', slot: '0000:41:00', functions: [], displayFunctions: [],
      vendorId: '0x10de', deviceId: '0x27b8', vendorName: 'NVIDIA', deviceName: 'AD104GL [L4]', subsystemName: null, classCode: '0x030200',
      iommuGroup: 3, iommuIsolated: true, mdev: false, vgpu: null, kind: 'gpu', consoleReason: null, mappings: [], connectionName: 'PROD', vms: [],
    },
  ],
  allocations: [
    alloc({}),
    alloc({ hostpci: 'hostpci1', deviceKey: 'c1:n1:0000:04:00', pciId: '0000:04:00.0' }),
    alloc({ vmid: null, vmName: null, hidden: true, deviceKey: 'c1:n1:0000:05:00' }),
    alloc({ vmid: '200', kind: 'console', deviceKey: 'c1:n1:0000:06:00' }),
  ],
  capacity: null,
}

const reading = (over: Partial<OrchestratorGpu>): OrchestratorGpu => ({
  connection_id: 'c1', target: 'vm:9010:GPU-a', source: 'guest', node: 'n1', vmid: 9010, index: 0, uuid: 'GPU-a', name: 'NVIDIA RTX A5000',
  bus_id: '0000:01:00', at: '', util: 90, mem_util: 40, mem_used: 20000, mem_total: 24564, temp: 80, power: 220, power_limit: 230, thermal_slow: false, power_slow: true,
  ...over,
})

describe('targetResolver', () => {
  const resolve = targetResolver(report)

  it('maps the n-th GPU a guest reports to its n-th GPU allocation in PCI order', () => {
    expect(resolve('c1', 'vm:9010:GPU-a', 0)?.deviceKey).toBe('c1:n1:0000:03:00')
    expect(resolve('c1', 'vm:9010:GPU-b', 1)?.deviceKey).toBe('c1:n1:0000:04:00')
    expect(resolve('c1', 'vm:9010:GPU-c', 5)?.deviceKey).toBe('c1:n1:0000:04:00')
  })

  it('maps a host reading to the device at its bus address on a visible node', () => {
    expect(resolve('c1', 'node:n1:0000:41:00', 0)).toEqual(expect.objectContaining({ deviceKey: 'c1:n1:0000:41:00', deviceName: 'AD104GL [L4]', vmid: null }))
    expect(resolve('c1', 'node:n9:0000:41:00', 0)).toBeNull()
  })

  it('never resolves a VM the caller cannot see, a console holder or a foreign connection', () => {
    expect(resolve('c1', 'vm:200:GPU-x', 0)).toBeNull()
    expect(resolve('c2', 'vm:9010:GPU-a', 0)).toBeNull()
    expect(resolve('c1', 'garbage', 0)).toBeNull()
  })
})

describe('visibleLatest', () => {
  it('keeps the readings and probes of what the caller sees', () => {
    const out = visibleLatest(report, {
      at: 'now',
      gpus: [reading({}), reading({ target: 'vm:777:GPU-z', vmid: 777 })],
      probes: [
        { connection_id: 'c1', kind: 'guest', vmid: 9010, status: 'ok', at: '', gpus: 1 },
        { connection_id: 'c1', kind: 'guest', vmid: 777, status: 'agent_unavailable', at: '', gpus: 0 },
        { connection_id: 'c1', kind: 'host', node: 'n1', status: 'ssh_unavailable', at: '', gpus: 0 },
        { connection_id: 'c1', kind: 'host', node: 'n9', status: 'ok', at: '', gpus: 1 },
      ],
    })
    expect(out.gpus).toHaveLength(1)
    expect(out.gpus[0]).toEqual(expect.objectContaining({ vmid: '9010', vmName: 'ai', deviceKey: 'c1:n1:0000:03:00', util: 90 }))
    expect(out.probes.map(p => p.vmid ?? p.node)).toEqual([9010, 'n1'])
  })
})

describe('visibleSeries', () => {
  it('groups the points per visible GPU and drops the others', () => {
    const p = (target: string, time: number): OrchestratorSeriesPoint => ({
      connection_id: 'c1', target, time, util: 50, util_max: 60, mem_util: 0, mem_used: 1000, mem_used_max: 1000, mem_total: 2000,
      temp_max: 50, power: 100, power_max: 120, power_limit: 230, thermal_slow: 0, power_slow: 0,
    })
    const out = visibleSeries(report, [p('vm:9010:GPU-a', 0), p('vm:777:GPU-z', 0), p('vm:9010:GPU-a', 300)], [reading({})])
    expect(out).toHaveLength(1)
    expect(out[0].points.map(x => x.time)).toEqual([0, 300])
    expect(out[0]).toEqual(expect.objectContaining({ vmName: 'ai', deviceKey: 'c1:n1:0000:03:00' }))
  })
})

describe('isGpuRange', () => {
  it('accepts the known ranges only', () => {
    expect(isGpuRange('24h')).toBe(true)
    expect(isGpuRange('2y')).toBe(false)
    expect(isGpuRange(undefined)).toBe(false)
  })
})

describe('vGPU readings', () => {
  const card = { ...report.devices[0], key: 'c1:n1:0000:03:00', id: '0000:03:00.0', slot: '0000:03:00', deviceName: 'GA102GL [RTX A5000]', mdev: true, vgpu: { mode: 'sriov' as const, virtualFunctions: ['0000:03:00.4', '0000:03:00.5'] } }
  const vgpuReport: GpuReport = {
    ...report,
    devices: [{ ...card, vms: [] }],
    allocations: [
      alloc({ vmid: '9010', vmName: 'ai', mdev: 'nvidia-665', via: 'mapping', smbiosUuid: 'aaf01d24-083c-4653-9644-e5840a3ad870' }),
      alloc({ vmid: '9011', vmName: 'worker', mdev: 'nvidia-665', via: 'mapping', smbiosUuid: 'e728897a-1e10-42fc-bf64-867303353599' }),
      alloc({ vmid: null, vmName: null, hidden: true, mdev: 'nvidia-665', via: 'mapping', smbiosUuid: null }),
    ],
  }
  const vgpu = (uuid: string, used: number): OrchestratorVgpu => ({
    connection_id: 'c1', node: 'n1', bus_id: '0000:03:00', id: uuid.slice(0, 4), vm_uuid: uuid.toUpperCase(), vm_name: 'x', type_id: 665, type_name: 'RTXA5000-12Q',
    fb_total: 12288, fb_used: used, util: 48, mem_util: 30, licensed: true, license: 'Licensed', guest_driver: '595.112.07', at: '',
  })

  it('ties each vGPU to its card and its VM through the SMBIOS UUID, and leaves out a VM the caller may not see', () => {
    const got = visibleVgpus(vgpuReport, [
      vgpu('aaf01d24-083c-4653-9644-e5840a3ad870', 9460),
      vgpu('e728897a-1e10-42fc-bf64-867303353599', 10244),
      vgpu('00000000-0000-0000-0000-000000000000', 1),
    ])
    expect(got.map(v => [v.vmid, v.deviceKey, v.profile, v.fbUsed])).toEqual([
      ['9010', 'c1:n1:0000:03:00', 'RTXA5000-12Q', 9460],
      ['9011', 'c1:n1:0000:03:00', 'RTXA5000-12Q', 10244],
    ])
  })

  it('names no VM on the host reading of a vGPU card, and lets it stand for the card', () => {
    const host = { connection_id: 'c1', target: 'node:n1:0000:03:00', source: 'host', node: 'n1', index: 0, uuid: 'GPU-h', name: 'A5000', bus_id: '0000:03:00', at: '', util: 95, mem_util: 40, mem_used: 22401, mem_total: 23028, temp: 46, power: 196, power_limit: 230, thermal_slow: false, power_slow: false } as OrchestratorGpu
    const guest = { ...host, target: 'vm:9010:GPU-g', source: 'guest', vmid: 9010, util: 48, temp: 0 } as OrchestratorGpu
    const latest = visibleLatest(vgpuReport, { at: '', gpus: [guest, host], probes: [] })
    expect(latest.gpus.find(g => g.source === 'host')).toEqual(expect.objectContaining({ deviceKey: 'c1:n1:0000:03:00', vmid: null }))
    expect(readingPerDevice(latest.gpus).get('c1:n1:0000:03:00')?.util).toBe(95)
    expect(latest.vgpus).toEqual([])
  })
})
