import { describe, expect, it } from 'vitest'

import type { VisibleVgpuType } from './metricsShared'
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from './report'
import { rankPlacements } from './vdcPlacement'
import type { VdcGpuEntry } from './vdcQuota'

const A = 'c1:n1:0000:03:00'
const B = 'c1:n1:0000:05:00'
const W = 'c1:n1:0000:04:00'

const cardTypes = (key: string): VisibleVgpuType[] => [
  { deviceKey: key, typeId: 666, name: 'RTXA5000-24Q', fbMemory: 24576, maxInstances: 1 },
  { deviceKey: key, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
]

const device = (key: string, slot: string, sriov: boolean, node = 'n1'): GpuReportDevice => ({
  key, connId: 'c1', node, id: `${slot}.0`, slot, functions: [`${slot}.0`], displayFunctions: [`${slot}.0`],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA Corporation', deviceName: 'GA102GL [RTX A5000]', subsystemName: null,
  classCode: '0x030200', iommuGroup: 1, iommuIsolated: true, mdev: sriov,
  vgpu: sriov ? { mode: 'sriov', virtualFunctions: [] } : null,
  kind: 'gpu', consoleReason: null, mappings: [], connectionName: 'PROD', vms: [],
})

const alloc = (vmid: string, deviceKey: string, extra: Partial<GpuReportAllocation> = {}): GpuReportAllocation => ({
  connId: 'c1', connectionName: 'PROD', node: 'n1', vmid, vmName: `vm-${vmid}`, vmStatus: 'running', template: false, hidden: false,
  hostpci: 'hostpci0', via: 'address', mapping: null, mdev: null, pooled: false, pool: 'p', uptime: null, smbiosUuid: null, pendingRemoval: false,
  kind: 'gpu', vendorName: null, deviceName: null, vendorId: '0x10de', deviceId: '0x2231', deviceKey, pciId: null, ...extra,
})

const report = (devices: GpuReportDevice[], allocations: GpuReportAllocation[] = []): GpuReport => ({
  scope: 'infrastructure', generatedAt: '2026-11-02T08:00:00.000Z',
  connections: [{ id: 'c1', name: 'PROD', error: null, capacity: null }],
  nodes: [], devices, allocations, capacity: null,
})

const entry = (kind: 'vgpu' | 'whole', profile: string): VdcGpuEntry => ({
  id: 'e', kind, modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: profile, count: 1,
})
const vgpu12 = entry('vgpu', 'RTXA5000-12Q')
const whole = entry('whole', '')

describe('rankPlacements', () => {
  it("only cards on the VM's node are offered", () => {
    const r = report([device(W, '0000:04:00', false, 'n2')])
    expect(rankPlacements(r, [], whole, 'n1')).toEqual([])
  })

  it('whole entries take a free card that is not shared out as vGPU', () => {
    const r = report([device(A, '0000:03:00', true), device(W, '0000:04:00', false)])
    const out = rankPlacements(r, cardTypes(A), whole, 'n1')
    expect(out.map((p) => [p.device.key, p.profile])).toEqual([[W, null]])
  })

  it('a card held by a template is not free', () => {
    const r = report([device(W, '0000:04:00', false)], [alloc('9000', W, { template: true })])
    expect(rankPlacements(r, [], whole, 'n1')).toEqual([])
  })

  it('vgpu entries prefer a card already carrying the profile, then the most free memory', () => {
    const catalog = [...cardTypes(A), ...cardTypes(B)]
    const devices = [device(B, '0000:05:00', true), device(A, '0000:03:00', true)]
    const withHolder = report(devices, [alloc('9001', A, { mdev: 'nvidia-665' })])
    expect(rankPlacements(withHolder, catalog, vgpu12, 'n1').map((p) => [p.device.key, p.profile])).toEqual([[A, 'nvidia-665'], [B, 'nvidia-665']])

    const other = report(devices, [alloc('9002', B, { mdev: 'nvidia-666' }), alloc('9003', A, { mdev: 'nvidia-665' })].slice(1))
    expect(rankPlacements(other, catalog, vgpu12, 'n1')[0].device.key).toBe(A)

    const empty = report(devices)
    expect(rankPlacements(empty, catalog, vgpu12, 'n1').map((p) => p.device.key)).toEqual([A, B])

    const unevenFree = report(devices, [alloc('9004', A, { mdev: 'nvidia-666' })])
    expect(rankPlacements(unevenFree, catalog, vgpu12, 'n1').map((p) => p.device.key)).toEqual([B])
  })

  it('without the profile anywhere, the card with the most free memory comes first', () => {
    const eightQ = (deviceKey: string): VisibleVgpuType => ({ deviceKey, typeId: 664, name: 'RTXA5000-8Q', fbMemory: 8192, maxInstances: 3 })
    const catalog = [...cardTypes(A), eightQ(A), ...cardTypes(B), eightQ(B)]
    const r = report([device(A, '0000:03:00', true), device(B, '0000:05:00', true)], [alloc('9005', A, { mdev: 'nvidia-664' })])
    const out = rankPlacements(r, catalog, vgpu12, 'n1')
    expect(out.map((p) => p.device.key)).toEqual([B, A])
  })

  it('a card without room for the profile is left out', () => {
    const r = report([device(A, '0000:03:00', true)], [alloc('9006', A, { mdev: 'nvidia-665' }), alloc('9007', A, { mdev: 'nvidia-665' })])
    expect(rankPlacements(r, cardTypes(A), vgpu12, 'n1')).toEqual([])
  })

  it('no catalog means no vGPU placement', () => {
    const r = report([device(A, '0000:03:00', true)])
    expect(rankPlacements(r, [], vgpu12, 'n1')).toEqual([])
  })
})
