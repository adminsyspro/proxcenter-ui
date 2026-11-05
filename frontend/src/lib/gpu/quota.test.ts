import { describe, expect, it } from 'vitest'

import { countGpuRefs, hostpciEntries } from './quota'

const dev = (slot: string, kind: 'gpu' | 'console', mappings: string[] = [], node = 'n1') => ({
  key: `c1:${node}:${slot}`, connId: 'c1', node, id: `${slot}.0`, slot, functions: [`${slot}.0`], displayFunctions: [`${slot}.0`],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA', deviceName: 'A5000', subsystemName: null, classCode: '0x030000',
  iommuGroup: 1, iommuIsolated: true, mdev: false, kind, consoleReason: null, mappings,
})
const snap = {
  devices: [dev('0000:03:00', 'gpu', ['a5000']), dev('0000:04:00', 'gpu'), dev('0000:05:00', 'console', ['bmc']), dev('0000:03:00', 'gpu', ['other'], 'n2')],
  allocations: [
    { deviceKey: 'c1:n1:0000:03:00', pool: 'vdc-a', template: false },
    { deviceKey: 'c1:n1:0000:04:00', pool: 'vdc-a', template: false },
    { deviceKey: 'c1:n1:0000:04:00', pool: 'vdc-a', template: true },
    { deviceKey: 'c1:n1:0000:05:00', pool: 'vdc-a', template: false },
    { deviceKey: 'c1:n1:0000:03:00', pool: 'vdc-b', template: false },
  ],
} as any

describe('countGpuRefs', () => {
  it('counts the entries that point at a GPU of the node, by mapping or by address', () => {
    expect(countGpuRefs(snap, 'n1', { hostpci0: 'mapping=a5000,pcie=1', hostpci1: '0000:04:00', hostpci2: 'mapping=bmc', hostpci3: '0000:99:00' })).toBe(2)
  })
  it('never counts a mapping of another node, nor a NIC passed through', () => {
    expect(countGpuRefs(snap, 'n1', { hostpci0: 'mapping=other' })).toBe(0)
    expect(countGpuRefs(snap, 'n1', {})).toBe(0)
  })
})

describe('hostpciEntries', () => {
  it('keeps the hostpciN keys only', () => {
    expect(hostpciEntries({ cores: 4, hostpci0: 'x', hostpci12: 'y', usb0: 'z' })).toEqual({ hostpci0: 'x', hostpci12: 'y' })
    expect(hostpciEntries(undefined)).toEqual({})
  })
})
