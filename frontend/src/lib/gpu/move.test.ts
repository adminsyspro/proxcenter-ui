import { describe, expect, it } from 'vitest'

import { moveTargets } from './move'
import type { GpuReport } from './report'

const dev = (node: string, slot: string, mappings: string[], vms: any[] = []) => ({
  key: `c1:${node}:${slot}`, connId: 'c1', node, id: `${slot}.0`, slot, functions: [], displayFunctions: [], vendorId: '0x10de', deviceId: '0x2231',
  vendorName: 'NVIDIA', deviceName: 'A5000', subsystemName: null, classCode: '0x030000', iommuGroup: 1, iommuIsolated: true, mdev: false, kind: 'gpu',
  consoleReason: null, mappings, connectionName: 'LAB', vms,
})
const alloc = (over: any = {}) => ({
  connId: 'c1', connectionName: 'LAB', node: 'n1', vmid: '100', vmName: 'ai', vmStatus: 'stopped', template: false, hidden: false, hostpci: 'hostpci0',
  via: 'mapping', mapping: 'a5000', mdev: null, pooled: false, pool: null, uptime: null, kind: 'gpu', vendorName: 'NVIDIA', deviceName: 'A5000',
  vendorId: '0x10de', deviceId: '0x2231', deviceKey: 'c1:n1:0000:03:00', pciId: '0000:03:00.0', ...over,
})
const node = (n: string, over: any = {}) => ({ node: n, online: true, error: null, connId: 'c1', connectionName: 'LAB', capacity: { total: 1, allocated: 0, free: 1, inUse: 0, consoles: 0 }, ...over })
const taken = { vmid: '200', vmName: 'other', vmStatus: 'stopped', hidden: false, template: false, hostpci: 'hostpci0', via: 'mapping', mdev: null, pooled: false }
const tpl = { ...taken, vmid: '300', template: true }

function report(allocations: any[], devices: any[], nodes: any[] = [node('n1'), node('n2'), node('n3')]): GpuReport {
  return { scope: 'infrastructure', generatedAt: '', connections: [], nodes, devices, allocations, capacity: null }
}

describe('moveTargets', () => {
  const devices = [
    dev('n1', '0000:03:00', ['a5000'], [taken]),
    dev('n2', '0000:03:00', ['a5000']),
    dev('n2', '0000:04:00', ['a5000'], [tpl]),
    dev('n3', '0000:03:00', ['a5000'], [taken]),
    dev('n3', '0000:05:00', ['other']),
  ]

  it('offers the nodes where the mapping has a free GPU, templates not counting as holders', () => {
    expect(moveTargets(report([alloc()], devices), 'c1', 'n1', '100')).toEqual({
      ok: true,
      mappings: ['a5000'],
      targets: [{ node: 'n2', freeGpus: 2, models: ['A5000'] }],
    })
  })

  it('needs as many free GPUs as the VM holds through the mapping', () => {
    const two = [alloc(), alloc({ hostpci: 'hostpci1', deviceKey: 'c1:n1:0000:09:00' })]
    const oneFree = devices.map(d => (d.key === 'c1:n2:0000:04:00' ? { ...d, vms: [taken] } : d))
    expect(moveTargets(report(two, oneFree), 'c1', 'n1', '100')).toEqual({ ok: false, reason: 'no_target', mappings: ['a5000'] })
    expect(moveTargets(report(two, devices), 'c1', 'n1', '100').ok).toBe(true)
  })

  it('refuses a running VM, a raw allocation, an unknown VM, and skips offline nodes', () => {
    expect(moveTargets(report([alloc({ vmStatus: 'running' })], devices), 'c1', 'n1', '100')).toEqual({ ok: false, reason: 'vm_running', mappings: [] })
    expect(moveTargets(report([alloc({ via: 'address', mapping: null })], devices), 'c1', 'n1', '100')).toEqual({ ok: false, reason: 'raw_allocation', mappings: [] })
    expect(moveTargets(report([], devices), 'c1', 'n1', '100')).toEqual({ ok: false, reason: 'not_found', mappings: [] })
    expect(moveTargets(report([alloc()], devices, [node('n1'), node('n2', { online: false })]), 'c1', 'n1', '100').ok).toBe(false)
  })
})
