import { describe, it, expect } from 'vitest'

import {
  sourceHardware, initialHardwareState, initialNicState, hardwareErrors, vlanTagInvalid, reviewIsValid,
  buildHardwarePayload, buildNicsPayload, mergeCpuModels, type ReviewSource,
  initialDiskState, keptReviewDisks, reviewDiskStorages, disksValid, buildDisksPayload, warmSpaceNeeds, tempStorageTypeFor,
  type ReviewDiskState, autoBootBus, isWindowsSource, scsiBootNeedsDrivers,
} from './migrationReview'

const GIB = 1024 ** 3
const source: ReviewSource = {
  numCPU: 4, numCoresPerSocket: 2, sockets: 2, memoryMB: 4096,
  nics: [
    { label: 'Network adapter 1', type: 'Vmxnet3', macAddress: '00:50:56:aa:00:01', network: 'VM Network' },
    { label: 'Network adapter 2', type: 'E1000', macAddress: '00:50:56:aa:00:02', network: 'dmz' },
  ],
  disks: [
    { label: 'Hard disk 1', capacityBytes: 40 * GIB, fileName: '[ds1] web/web.vmdk' },
    { label: 'Hard disk 2', capacityBytes: 10 * GIB, fileName: '[ds1] web/web_1.vmdk' },
  ],
}
const hw = { cores: '2', sockets: '1', memoryMB: '2048' }
const row = (storage: string, exclude = false): ReviewDiskState => ({ storage, exclude })

describe('sourceHardware / initial state', () => {
  it('derives cores per socket like the mapper, and falls back to the total vCPU count', () => {
    expect(sourceHardware(source)).toEqual({ cores: 2, sockets: 2, memoryMB: 4096 })
    expect(sourceHardware({ ...source, numCoresPerSocket: 0 })).toEqual({ cores: 4, sockets: 2, memoryMB: 4096 })
    expect(sourceHardware(null)).toEqual({ cores: 0, sockets: 0, memoryMB: 0 })
  })

  it('starts the fields on the source values and one NIC row per source adapter', () => {
    expect(initialHardwareState(source)).toEqual({ cores: '2', sockets: '2', memoryMB: '4096' })
    expect(initialHardwareState(null)).toEqual({ cores: '', sockets: '', memoryMB: '' })
    expect(initialNicState(source, 'vmbr0', '')).toEqual([
      { bridge: 'vmbr0', vlanTag: '', model: '' }, { bridge: 'vmbr0', vlanTag: '', model: '' },
    ])
    expect(initialNicState(null, 'vmbr0', '')).toEqual([])
  })
})

describe('validation', () => {
  it('flags values outside the Proxmox limits, never a blank field', () => {
    expect(hardwareErrors({ cores: '', sockets: '', memoryMB: '' })).toEqual({ cores: false, sockets: false, memoryMB: false })
    expect(hardwareErrors({ cores: '0', sockets: '5', memoryMB: '8' })).toEqual({ cores: true, sockets: true, memoryMB: true })
    expect(hardwareErrors({ cores: '128', sockets: '4', memoryMB: '16' })).toEqual({ cores: false, sockets: false, memoryMB: false })
  })

  it('validates a VLAN tag like the step-1 field', () => {
    expect(vlanTagInvalid('')).toBe(false)
    expect(vlanTagInvalid('42')).toBe(false)
    expect(vlanTagInvalid('0')).toBe(true)
    expect(vlanTagInvalid('4095')).toBe(true)
  })

  it('blocks the launch on a bad field or a NIC without a bridge', () => {
    expect(reviewIsValid(hw, [{ bridge: 'vmbr0', vlanTag: '', model: '' }])).toBe(true)
    expect(reviewIsValid(hw, [{ bridge: '', vlanTag: '', model: '' }])).toBe(false)
    expect(reviewIsValid(hw, [{ bridge: 'vmbr0', vlanTag: '9999', model: '' }])).toBe(false)
    expect(reviewIsValid({ ...hw, cores: '200' }, [])).toBe(false)
  })
})

describe('payload', () => {
  it('sends only the hardware values that differ from the source', () => {
    expect(buildHardwarePayload({ cores: '2', sockets: '2', memoryMB: '4096' }, source)).toBeUndefined()
    expect(buildHardwarePayload({ cores: '4', sockets: '', memoryMB: '8192' }, source)).toEqual({ cores: 4, memoryMB: 8192 })
    expect(buildHardwarePayload({ cores: 'x', sockets: '1', memoryMB: '' }, source)).toEqual({ sockets: 1 })
  })

  it('maps every NIC by position, with the tag only when the operator may set one', () => {
    const nics = [{ bridge: 'vmbr0', vlanTag: '42', model: '' }, { bridge: 'vf95117a', vlanTag: '', model: 'e1000' }]
    expect(buildNicsPayload(nics, true)).toEqual([{ index: 0, bridge: 'vmbr0', vlanTag: 42 }, { index: 1, bridge: 'vf95117a', model: 'e1000' }])
    expect(buildNicsPayload(nics, false)).toEqual([{ index: 0, bridge: 'vmbr0' }, { index: 1, bridge: 'vf95117a', model: 'e1000' }])
    expect(buildNicsPayload([], true)).toBeUndefined()
  })

  it('maps every disk by position, with exclude where set and never on the boot disk', () => {
    expect(buildDisksPayload([row('san-lvm'), row('tank'), row('tank', true)])).toEqual([
      { index: 0, targetStorage: 'san-lvm' }, { index: 1, targetStorage: 'tank' }, { index: 2, exclude: true },
    ])
    expect(buildDisksPayload([row(' san-lvm ', true)])).toEqual([{ index: 0, targetStorage: 'san-lvm' }])
    expect(buildDisksPayload([])).toBeUndefined()
  })

  it('merges the quick CPU list with the node models, custom ones prefixed', () => {
    const quick = ['x86-64-v2-AES', 'host']
    expect(mergeCpuModels(quick, [{ name: 'host' }, { name: 'kvm64' }, { name: 'gold', custom: 1 }, { name: 'EPYC' }, { name: '' }]))
      .toEqual(['x86-64-v2-AES', 'host', 'custom-gold', 'EPYC', 'kvm64'])
    expect(mergeCpuModels(quick, undefined)).toEqual(quick)
  })
})

describe('disks (lot 2)', () => {
  it('starts one row per source disk, all migrated and on the dialog storage', () => {
    expect(initialDiskState(source, 'san-lvm')).toEqual([row('san-lvm'), row('san-lvm')])
    expect(initialDiskState(null, 'san-lvm')).toEqual([])
  })

  it('keeps the boot disk whatever its row says, and lists the storages of the kept disks', () => {
    expect(keptReviewDisks([row('a', true), row('b', true), row('c')])).toEqual([{ index: 0, storage: 'a' }, { index: 2, storage: 'c' }])
    expect(reviewDiskStorages([row('a'), row('b', true), row('a'), row(' ')], 'dflt')).toEqual(['a'])
    // no row yet (source not read, or outside the review step): the default alone
    expect(reviewDiskStorages([], 'dflt')).toEqual(['dflt'])
    expect(reviewDiskStorages([], '')).toEqual([])
  })

  it('needs a storage on every kept disk, not on an excluded one', () => {
    expect(disksValid([row('a'), row('', true)])).toBe(true)
    expect(disksValid([row('a'), row('')])).toBe(false)
    expect(disksValid([row('', true)])).toBe(false)
    const nics = [{ bridge: 'vmbr0', vlanTag: '', model: '' }]
    expect(reviewIsValid(hw, nics, [row('a'), row('b')])).toBe(true)
    expect(reviewIsValid(hw, nics, [row('a'), row(' ')])).toBe(false)
    expect(reviewIsValid(hw, nics)).toBe(true)
  })

  it('asks each storage for the committed bytes of the disks bound to it, by capacity share', () => {
    // every disk on the default storage: exactly what the step-1 check asks
    expect(warmSpaceNeeds([row('san-lvm'), row('san-lvm')], source, 25 * GIB + 1, 'san-lvm')).toEqual([{ storage: 'san-lvm', requiredBytes: 25 * GIB + 1 }])
    // 40 GiB and 10 GiB disks, 25 GiB committed: 20 GiB and 5 GiB
    expect(warmSpaceNeeds([row('san-lvm'), row('tank')], source, 25 * GIB, 'san-lvm')).toEqual([
      { storage: 'san-lvm', requiredBytes: 20 * GIB }, { storage: 'tank', requiredBytes: 5 * GIB },
    ])
    // an excluded disk's share is not asked for
    expect(warmSpaceNeeds([row('san-lvm'), row('tank', true)], source, 25 * GIB, 'san-lvm')).toEqual([{ storage: 'san-lvm', requiredBytes: 20 * GIB }])
    // unknown capacities: even split over the kept disks
    const blind = { ...source, disks: source.disks.map(d => ({ ...d, capacityBytes: 0 })) }
    expect(warmSpaceNeeds([row('a'), row('b')], blind, 10 * GIB, 'a')).toEqual([{ storage: 'a', requiredBytes: 5 * GIB }, { storage: 'b', requiredBytes: 5 * GIB }])
    // no row: the default storage takes everything; a blank row is skipped; a negative size counts as zero
    expect(warmSpaceNeeds([], source, 3, 'dflt')).toEqual([{ storage: 'dflt', requiredBytes: 3 }])
    expect(warmSpaceNeeds([], source, 3, '')).toEqual([])
    expect(warmSpaceNeeds([row('a'), row('')], source, 50 * GIB, 'dflt')).toEqual([{ storage: 'a', requiredBytes: 40 * GIB }])
    expect(warmSpaceNeeds([row('a')], source, -5, 'dflt')).toEqual([{ storage: 'a', requiredBytes: 0 }])
  })

  it('sizes the cold temp space on the worst target: one block storage means every disk is staged twice', () => {
    expect(tempStorageTypeFor([])).toBeUndefined()
    expect(tempStorageTypeFor(['nfs', 'dir'])).toBe('nfs')
    expect(tempStorageTypeFor(['nfs', 'lvm'])).toBe('lvm')
    expect(tempStorageTypeFor(['nfs', undefined])).toBeUndefined()
  })
})

describe('guest conversion helpers (#1000)', () => {
  const rows: ReviewDiskState[] = [{ storage: 'Ceph', exclude: false, bus: 'scsi' }, { storage: 'Ceph', exclude: false, bus: 'auto' }, { storage: 'Ceph', exclude: true, bus: 'sata' }]

  it('sends the forced buses only where the engine applies them', () => {
    expect(buildDisksPayload(rows, { withBus: true })).toEqual([
      { index: 0, targetStorage: 'Ceph', bus: 'scsi' },
      { index: 1, targetStorage: 'Ceph' },
      { index: 2, exclude: true },
    ])
    expect(buildDisksPayload(rows)).toEqual([{ index: 0, targetStorage: 'Ceph' }, { index: 1, targetStorage: 'Ceph' }, { index: 2, exclude: true }])
  })

  it('resolves Auto for the boot disk like the engine', () => {
    const linuxBios = { numCPU: 1, numCoresPerSocket: 1, sockets: 1, memoryMB: 1, nics: [], disks: [], firmware: 'bios', guestOS: 'CentOS 7 (64-bit)' }
    expect(autoBootBus(linuxBios, false)).toBe('scsi')
    expect(autoBootBus({ ...linuxBios, firmware: 'efi' }, false)).toBe('sata')
    expect(autoBootBus({ ...linuxBios, guestOS: 'Microsoft Windows Server 2022 (64-bit)' }, false)).toBe('sata')
    expect(autoBootBus({ ...linuxBios, firmware: 'efi' }, true)).toBe('scsi')
    expect(isWindowsSource(null)).toBe(false)
  })

  it('flags a forced SCSI boot disk only without the conversion', () => {
    expect(scsiBootNeedsDrivers(rows, false)).toBe(true)
    expect(scsiBootNeedsDrivers(rows, true)).toBe(false)
    expect(scsiBootNeedsDrivers([], false)).toBe(false)
  })
})
