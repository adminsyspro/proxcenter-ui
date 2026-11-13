import { describe, expect, it } from 'vitest'

import { hostpciValue, isMappedHostpci, isQ35, mappingIdFor, mappingMapEntry, nextHostpciIndex, rawReleaseCommand } from './actions'

describe('nextHostpciIndex', () => {
  it('takes the first free slot', () => {
    expect(nextHostpciIndex({})).toBe(0)
    expect(nextHostpciIndex({ hostpci0: 'x', hostpci2: 'y' })).toBe(1)
  })
  it('says when the sixteen are taken', () => {
    expect(nextHostpciIndex(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`hostpci${i}`, 'x'])))).toBe(-1)
  })
})

describe('hostpciValue', () => {
  it('asks for PCIe on q35 machines only', () => {
    expect(isQ35({ machine: 'q35' })).toBe(true)
    expect(isQ35({ machine: 'pc-q35-9.2+pve1' })).toBe(true)
    expect(isQ35({ machine: 'type=q35,viommu=intel' })).toBe(true)
    expect(isQ35({})).toBe(false)
    expect(hostpciValue('gpu-a', { machine: 'q35' })).toBe('mapping=gpu-a,pcie=1')
    expect(hostpciValue('gpu-a', {})).toBe('mapping=gpu-a')
  })
})

describe('isMappedHostpci', () => {
  it('tells a mapped allocation from a raw one', () => {
    expect(isMappedHostpci('mapping=a5000,pcie=1')).toBe(true)
    expect(isMappedHostpci('pcie=1,mapping=a5000')).toBe(true)
    expect(isMappedHostpci('0000:03:00,pcie=1')).toBe(false)
    expect(isMappedHostpci(undefined)).toBe(false)
  })
})

describe('mapping helpers', () => {
  const dev = { node: 'PVE9-A5000.lab', slot: '0000:03:00', vendorId: '0x10de', deviceId: '0x2231', iommuGroup: 35 }

  it('names the mapping after the node and the bus', () => {
    expect(mappingIdFor(dev)).toBe('gpu-pve9-a5000-lab-03-00')
  })

  it('builds the map entry PVE expects', () => {
    expect(mappingMapEntry(dev)).toBe('node=PVE9-A5000.lab,path=0000:03:00,id=10de:2231,iommugroup=35')
    expect(mappingMapEntry({ ...dev, iommuGroup: null })).toBe('node=PVE9-A5000.lab,path=0000:03:00,id=10de:2231')
    expect(mappingMapEntry({ ...dev, deviceId: null })).toBeNull()
  })

  it('gives the root command for a raw allocation', () => {
    expect(rawReleaseCommand(9001, 'hostpci0')).toBe('qm set 9001 --delete hostpci0')
  })
})
