import { describe, expect, it } from 'vitest'

import type { ConnectionGpuSnapshot } from './collect'
import { collectNodeDevices, parsePciMappings, resolveAllocations, type PvePciEntry } from './inventory'
import { buildGpuReport, nodeVisibilityKey, vmVisibilityKey } from './report'

const pci = (id: string, extra: Partial<PvePciEntry> = {}): PvePciEntry => ({
  id, class: '0x030000', vendor: '0x10de', device: '0x2204', vendor_name: 'NVIDIA Corporation', device_name: 'GA102', iommugroup: Number(id.slice(5, 7)), ...extra,
})

function snapshot(): ConnectionGpuSnapshot {
  const mappings = parsePciMappings([{ id: 'gpu-n2', map: ['node=n2,path=0000:01:00'] }])
  const devices = [
    ...collectNodeDevices('c1', 'n1', [pci('0000:01:00.0'), pci('0000:02:00.0'), pci('0000:03:00.0', { vendor: '0x1a03', vendor_name: 'ASPEED' })], mappings),
    ...collectNodeDevices('c1', 'n2', [pci('0000:01:00.0')], mappings),
  ]
  const guest = (vmid: string, node: string, status: string, pool: string | null, hostpci0: string) => ({
    vmid, node, name: `vm-${vmid}`, status, template: false, pool, tags: [], config: { hostpci0 },
  })
  return {
    connId: 'c1',
    connectionName: 'PROD',
    error: null,
    mappingsError: null,
    guestsError: null,
    nodes: [
      { node: 'n1', online: true, error: null },
      { node: 'n2', online: true, error: null },
      { node: 'n3', online: false, error: null },
    ],
    devices,
    allocations: resolveAllocations('c1', devices, mappings, [
      guest('100', 'n1', 'running', null, '01:00'),
      guest('101', 'n2', 'stopped', 'tenant-pool', 'mapping=gpu-n2'),
      guest('102', 'n1', 'stopped', 'tenant-pool', '0000:03:00.0'),
    ]),
    configReads: 3,
    generatedAt: '2026-10-14T08:00:00.000Z',
  }
}

const dead: ConnectionGpuSnapshot = {
  connId: 'c2', connectionName: 'DR', error: 'ECONNREFUSED', mappingsError: null, guestsError: null, nodes: [], devices: [], allocations: [], configReads: 0, generatedAt: '2026-10-14T08:00:01.000Z',
}

describe('buildGpuReport, infrastructure scope', () => {
  it('gives devices, allocation map and capacity per node, per cluster and in total', () => {
    const r = buildGpuReport([snapshot(), dead], { tenantPools: null, visibleNodes: null, visibleVms: null })
    expect(r.scope).toBe('infrastructure')
    expect(r.generatedAt).toBe('2026-10-14T08:00:00.000Z')
    expect(r.capacity).toEqual({ total: 3, allocated: 2, free: 1, inUse: 1, consoles: 1 })
    expect(r.connections).toEqual([
      { id: 'c1', name: 'PROD', error: null, capacity: { total: 3, allocated: 2, free: 1, inUse: 1, consoles: 1 } },
      { id: 'c2', name: 'DR', error: 'ECONNREFUSED', capacity: { total: 0, allocated: 0, free: 0, inUse: 0, consoles: 0 } },
    ])
    expect(r.nodes.map((n) => [n.node, n.online, n.capacity.total, n.capacity.allocated])).toEqual([
      ['n1', true, 2, 1],
      ['n2', true, 1, 1],
      ['n3', false, 0, 0],
    ])
    expect(r.devices).toHaveLength(4)
    const n1gpu = r.devices.find((d) => d.key === 'c1:n1:0000:01:00')!
    expect(n1gpu.connectionName).toBe('PROD')
    expect(n1gpu.vms).toEqual([{ vmid: '100', vmName: 'vm-100', vmStatus: 'running', hidden: false, template: false, hostpci: 'hostpci0', via: 'address', mdev: null, pooled: false }])
    expect(r.allocations.map((a) => [a.vmid, a.kind, a.pciId, a.mapping])).toEqual([
      ['100', 'gpu', '0000:01:00.0', null],
      ['101', 'gpu', '0000:01:00.0', 'gpu-n2'],
      ['102', 'console', '0000:03:00.0', null],
    ])
  })

  it('restricts devices to the viewable nodes and withholds the identity of a VM out of scope', () => {
    const r = buildGpuReport([snapshot()], {
      tenantPools: null,
      visibleNodes: new Set([nodeVisibilityKey('c1', 'n1')]),
      visibleVms: new Set([vmVisibilityKey('c1', 'n2', '101')]),
    })
    expect(r.nodes.map((n) => n.node)).toEqual(['n1'])
    expect(r.devices.map((d) => d.node)).toEqual(['n1', 'n1', 'n1'])
    expect(r.capacity).toEqual({ total: 2, allocated: 1, free: 1, inUse: 1, consoles: 1 })
    // 100 and 102 sit on a visible node but are not viewable; 101 is viewable on a hidden node.
    expect(r.allocations.map((a) => [a.vmid, a.vmName, a.hidden, a.node])).toEqual([
      [null, null, true, 'n1'],
      ['101', 'vm-101', false, 'n2'],
      [null, null, true, 'n1'],
    ])
    expect(r.devices[0].vms[0]).toMatchObject({ vmid: null, hidden: true, hostpci: null })
  })

  it('carries the pending removal, withheld with the rest of a hidden VM', () => {
    const snap = snapshot()
    snap.allocations = snap.allocations.map((a) => (a.vmid === '100' ? { ...a, pendingRemoval: true } : a))
    const all = buildGpuReport([snap], { tenantPools: null, visibleNodes: null, visibleVms: null })
    expect(all.allocations.map((a) => [a.vmid, a.pendingRemoval])).toEqual([['100', true], ['101', false], ['102', false]])
    const hidden = buildGpuReport([snap], { tenantPools: null, visibleNodes: null, visibleVms: new Set([vmVisibilityKey('c1', 'n2', '101')]) })
    expect(hidden.allocations.find((a) => a.hidden)?.pendingRemoval).toBe(false)
  })

  it('narrows to one node', () => {
    const r = buildGpuReport([snapshot()], { tenantPools: null, visibleNodes: null, visibleVms: null, node: 'n2' })
    expect(r.nodes.map((n) => n.node)).toEqual(['n2'])
    expect(r.devices.map((d) => d.key)).toEqual(['c1:n2:0000:01:00'])
    expect(r.allocations.map((a) => a.vmid)).toEqual(['101'])
    expect(r.capacity).toMatchObject({ total: 1, allocated: 1 })
  })

  it('leaves out a connection the caller sees no node of', () => {
    const r = buildGpuReport([snapshot()], { tenantPools: null, visibleNodes: new Set(), visibleVms: new Set() })
    expect(r.connections).toEqual([])
    expect(r.devices).toEqual([])
    expect(r.allocations).toEqual([])
    expect(r.capacity).toEqual({ total: 0, allocated: 0, free: 0, inUse: 0, consoles: 0 })
  })
})

describe('buildGpuReport, vDC tenant scope', () => {
  it('only lists the GPUs held by the tenant VMs, without any provider inventory', () => {
    const r = buildGpuReport([snapshot(), dead], {
      tenantPools: new Map([['c1', new Set(['tenant-pool'])]]),
      visibleNodes: null,
      visibleVms: null,
    })
    expect(r.scope).toBe('tenant')
    expect(r.devices).toEqual([])
    expect(r.nodes).toEqual([])
    expect(r.capacity).toBeNull()
    expect(r.connections).toEqual([{ id: 'c1', name: 'PROD', error: null, capacity: null }])
    expect(r.allocations).toEqual([
      expect.objectContaining({ vmid: '101', node: 'n2', kind: 'gpu', vendorName: 'NVIDIA Corporation', deviceName: 'GA102', vendorId: '0x10de', deviceId: '0x2204', deviceKey: null, pciId: null, mapping: null, via: 'mapping' }),
      expect.objectContaining({ vmid: '102', kind: 'console', pciId: null }),
    ])
    expect(JSON.stringify(r)).not.toContain('vm-100')
    expect(JSON.stringify(r)).not.toContain('gpu-n2')
    expect(JSON.stringify(r)).not.toContain('0000:')
  })

  it('carries the pending removal of the tenant GPUs', () => {
    const snap = snapshot()
    snap.allocations = snap.allocations.map((a) => (a.vmid === '101' ? { ...a, pendingRemoval: true } : a))
    const r = buildGpuReport([snap], { tenantPools: new Map([['c1', new Set(['tenant-pool'])]]), visibleNodes: null, visibleVms: null })
    expect(r.allocations.map((a) => [a.vmid, a.pendingRemoval])).toEqual([['101', true], ['102', false]])
  })

  it('applies vm.view and the node filter on top of the pools', () => {
    const r = buildGpuReport([snapshot()], {
      tenantPools: new Map([['c1', new Set(['tenant-pool'])]]),
      visibleNodes: null,
      visibleVms: new Set([vmVisibilityKey('c1', 'n1', '102'), vmVisibilityKey('c1', 'n2', '101')]),
      node: 'n1',
    })
    expect(r.allocations.map((a) => a.vmid)).toEqual(['102'])
  })
})
