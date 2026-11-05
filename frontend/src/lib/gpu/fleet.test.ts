import { describe, expect, it } from 'vitest'

import { attentionByKind, attentionItems, contentions, modelBreakdown, scopeReport, workloads } from './fleet'
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from './report'

const cap = { total: 0, allocated: 0, free: 0, inUse: 0, consoles: 0 }

function device(key: string, over: Partial<GpuReportDevice> = {}): GpuReportDevice {
  const [connId, node, slot] = key.split('|')
  return {
    key: `${connId}:${node}:${slot}`,
    connId,
    node,
    id: `${slot}.0`,
    slot,
    functions: [`${slot}.0`],
    displayFunctions: [`${slot}.0`],
    vendorId: '0x10de',
    deviceId: '0x2231',
    vendorName: 'NVIDIA Corporation',
    deviceName: 'GA102GL [RTX A5000]',
    subsystemName: null,
    classCode: '0x030000',
    iommuGroup: 1,
    iommuIsolated: true,
    mdev: false, vgpu: null,
    kind: 'gpu',
    consoleReason: null,
    mappings: [],
    connectionName: connId.toUpperCase(),
    vms: [],
    ...over,
  }
}

function alloc(d: GpuReportDevice, vmid: string, over: Partial<GpuReportAllocation> = {}): GpuReportAllocation {
  return {
    connId: d.connId,
    connectionName: d.connectionName,
    node: d.node,
    vmid,
    vmName: `vm-${vmid}`,
    vmStatus: 'stopped',
    template: false,
    hidden: false,
    hostpci: 'hostpci0',
    via: 'address',
    mapping: null,
    mdev: null,
    pooled: false,
    pool: null,
    uptime: null, smbiosUuid: null, pendingRemoval: false,
    kind: 'gpu',
    vendorName: d.vendorName,
    deviceName: d.deviceName,
    vendorId: d.vendorId,
    deviceId: d.deviceId,
    deviceKey: d.key,
    pciId: d.id,
    ...over,
  }
}

/** Builds the report the API would return: every device lists its allocations. */
function report(devices: GpuReportDevice[], allocations: GpuReportAllocation[], over: Partial<GpuReport> = {}): GpuReport {
  return {
    scope: 'infrastructure',
    generatedAt: '2026-11-01T00:00:00.000Z',
    connections: [],
    nodes: [],
    devices: devices.map((d) => ({
      ...d,
      vms: allocations
        .filter((a) => a.deviceKey === d.key)
        .map((a) => ({ vmid: a.vmid, vmName: a.vmName, vmStatus: a.vmStatus, hidden: a.hidden, template: a.template, hostpci: a.hostpci, via: a.via, mdev: a.mdev, pooled: a.pooled })),
    })),
    allocations,
    capacity: cap,
    ...over,
  }
}

const a5000 = device('prod|n1|0000:03:00')
const a5000b = device('dr|n2|0000:03:00')
const l4 = device('prod|n1|0000:41:00', { deviceId: '0x27b8', deviceName: 'AD104GL [L4]' })
const bmc = device('prod|n1|0000:05:03', { kind: 'console', consoleReason: 'vendor', vendorId: '0x102b', deviceId: '0x0532', deviceName: 'MGA G200eW' })

describe('modelBreakdown', () => {
  it('groups the GPUs by model across clusters and leaves the consoles out', () => {
    const r = report([a5000, a5000b, l4, bmc], [alloc(a5000, '100', { vmStatus: 'running' }), alloc(l4, '101')])
    expect(modelBreakdown(r)).toEqual([
      expect.objectContaining({ deviceName: 'GA102GL [RTX A5000]', total: 2, allocated: 1, free: 1, inUse: 1, clusters: ['DR', 'PROD'] }),
      expect.objectContaining({ deviceName: 'AD104GL [L4]', total: 1, allocated: 1, free: 0, inUse: 0, clusters: ['PROD'] }),
    ])
  })

  it('falls back on the device name when the PCI IDs are missing', () => {
    const anon = device('prod|n1|0000:07:00', { vendorId: null, deviceId: null, deviceName: 'Unknown GPU' })
    expect(modelBreakdown(report([anon], []))[0].key).toBe('name:Unknown GPU')
  })
})

describe('contentions', () => {
  it('flags a GPU held by two VMs that could run, and names the one running', () => {
    const r = report([a5000], [alloc(a5000, '100', { vmStatus: 'running' }), alloc(a5000, '101'), alloc(a5000, '102', { template: true })])
    const [c] = contentions(r)
    expect(c.holders.map((h) => h.vmid)).toEqual(['100', '101'])
    expect(c.running?.vmid).toBe('100')
  })

  it('ignores templates and pooled mappings', () => {
    const r = report([a5000], [alloc(a5000, '100'), alloc(a5000, '102', { template: true }), alloc(a5000, '103', { via: 'mapping', pooled: true })])
    expect(contentions(r)).toEqual([])
  })
})

describe('workloads', () => {
  it('gives one row per VM, running first, templates last, hidden VMs out', () => {
    const r = report(
      [a5000, l4],
      [
        alloc(a5000, '102', { template: true, vmName: 'tpl' }),
        alloc(a5000, '101', { vmName: 'b-stopped' }),
        alloc(a5000, '100', { vmStatus: 'running', vmName: 'z-running', uptime: 7200, pool: 'ml' }),
        alloc(l4, '100', { vmStatus: 'running', vmName: 'z-running', hostpci: 'hostpci1' }),
        alloc(l4, '0', { hidden: true, vmid: null, vmName: null }),
        alloc(bmc, '103', { kind: 'console', vmName: 'console-only' }),
      ],
    )
    const rows = workloads(r)
    expect(rows.map((w) => w.vmid)).toEqual(['100', '101', '102'])
    expect(rows[0]).toEqual(expect.objectContaining({ pool: 'ml', uptime: 7200 }))
    expect(rows[0].conflict?.kind).toBe('shared')
    expect(rows[0].gpus).toHaveLength(2)
    expect(rows[1].conflict?.kind).toBe('shared')
    expect(rows[2].conflict).toBeNull()
  })
})

describe('attentionItems', () => {
  it('lists unreadable connections and nodes and GPUs without isolation, not a shared or reserved GPU', () => {
    const shared = device('prod|n1|0000:42:00', { iommuIsolated: false })
    const r = report([a5000, shared], [alloc(a5000, '100', { vmStatus: 'running' }), alloc(a5000, '101'), alloc(shared, '102', { template: true })], {
      connections: [{ id: 'dr', name: 'DR', error: 'timeout', capacity: null }],
      nodes: [{ node: 'n3', online: true, error: 'HTTP 500', connId: 'prod', connectionName: 'PROD', capacity: cap }],
    })
    expect(attentionItems(r).map((i) => i.kind)).toEqual(['connectionError', 'nodeError', 'notIsolated'])
  })

  it('says nothing about a healthy fleet', () => {
    expect(attentionItems(report([a5000, l4], [alloc(a5000, '100', { vmStatus: 'running' })]))).toEqual([])
  })
})

describe('attentionByKind', () => {
  it('groups the items by kind, worst kinds first, empty kinds left out', () => {
    const r = report([a5000], [alloc(a5000, '100', { vmStatus: 'running' }), alloc(a5000, '101')], {
      connections: [{ id: 'dr', name: 'DR', error: 'timeout', capacity: null }],
    })
    expect(attentionByKind(attentionItems(r)).map((g) => [g.kind, g.items.length])).toEqual([['connectionError', 1]])
  })
})

describe('scopeReport', () => {
  it('narrows the report to a cluster, then to a node', () => {
    const n2 = device('prod|n2|0000:03:00')
    const r = report([a5000, a5000b, n2], [alloc(a5000, '100'), alloc(n2, '101')], {
      connections: [{ id: 'prod', name: 'PROD', error: null, capacity: null }, { id: 'dr', name: 'DR', error: null, capacity: null }],
    })
    const prod = scopeReport(r, { connId: 'prod' })
    expect(prod.devices.map((d) => d.key)).toEqual([a5000.key, n2.key])
    expect(prod.connections.map((c) => c.id)).toEqual(['prod'])
    const node = scopeReport(r, { connId: 'prod', node: 'n2' })
    expect(node.devices.map((d) => d.key)).toEqual([n2.key])
    expect(node.allocations.map((a) => a.vmid)).toEqual(['101'])
    expect(scopeReport(r, {})).toBe(r)
  })
})
