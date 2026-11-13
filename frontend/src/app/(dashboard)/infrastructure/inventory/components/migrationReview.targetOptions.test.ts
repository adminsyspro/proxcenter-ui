/** ui#1330 (MAC) and ui#1331 (disk options) in the review step state. */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DISK_PROFILE, buildDiskOptionsPayload, buildDisksPayload, buildNicsPayload, effectiveDiskOption,
  nicMacError, nicsChangeMac, profileDiskOption, reviewIsValid, type ReviewNicState,
} from './migrationReview'

const nic = (patch: Partial<ReviewNicState> = {}): ReviewNicState => ({ bridge: 'vmbr0', vlanTag: '', model: '', macMode: 'keep', mac: '', ...patch })
const hw = { cores: '2', sockets: '1', memoryMB: '2048' }

describe('NIC MAC choice', () => {
  it('flags a custom MAC that is not unicast, or set twice', () => {
    const nics = [nic({ macMode: 'custom', mac: 'bc:24:11:00:00:01' }), nic({ macMode: 'custom', mac: 'BC-24-11-00-00-01' }), nic({ macMode: 'custom', mac: '01:00:5e:00:00:01' })]
    expect(nicMacError(nics, 0)).toBe('duplicate')
    expect(nicMacError(nics, 1)).toBe('duplicate')
    expect(nicMacError(nics, 2)).toBe('format')
    expect(nicMacError([nic()], 0)).toBeNull()
    expect(reviewIsValid(hw, nics)).toBe(false)
    expect(reviewIsValid(hw, [nic({ macMode: 'custom', mac: 'BC:24:11:00:00:01' }), nic({ macMode: 'regenerate' })])).toBe(true)
  })

  it('says when a NIC leaves its source MAC', () => {
    expect(nicsChangeMac([nic(), nic()])).toBe(false)
    expect(nicsChangeMac([nic(), nic({ macMode: 'regenerate' })])).toBe(true)
  })

  it('sends the MAC choice of each NIC, the custom one normalised', () => {
    expect(buildNicsPayload([nic(), nic({ macMode: 'regenerate' }), nic({ macMode: 'custom', mac: 'bc-24-11-00-00-01' })], true)).toEqual([
      { index: 0, bridge: 'vmbr0' },
      { index: 1, bridge: 'vmbr0', macMode: 'regenerate' },
      { index: 2, bridge: 'vmbr0', macMode: 'custom', mac: 'BC:24:11:00:00:01' },
    ])
  })
})

describe('disk options', () => {
  it('sends only the departures from the default profile', () => {
    expect(buildDiskOptionsPayload(DEFAULT_DISK_PROFILE)).toBeUndefined()
    expect(buildDiskOptionsPayload({ discard: false, iothread: true, ssd: true })).toEqual({ discard: false, ssd: true })
  })

  it('shows discard on a thin storage only, the other options as the profile says', () => {
    expect(profileDiskOption('discard', DEFAULT_DISK_PROFILE, 'rbd')).toBe(true)
    expect(profileDiskOption('discard', DEFAULT_DISK_PROFILE, 'lvm')).toBe(false)
    expect(profileDiskOption('iothread', DEFAULT_DISK_PROFILE, 'lvm')).toBe(true)
    expect(profileDiskOption('ssd', { ...DEFAULT_DISK_PROFILE, ssd: true }, undefined)).toBe(true)
    const row = { storage: 'lvm', exclude: false, options: { discard: true } }
    expect(effectiveDiskOption(row, 'discard', DEFAULT_DISK_PROFILE, 'lvm')).toBe(true)
    expect(effectiveDiskOption(row, 'ssd', DEFAULT_DISK_PROFILE, 'lvm')).toBe(false)
  })

  it('sends the options set on a disk with its storage, never on an excluded one', () => {
    expect(buildDisksPayload([
      { storage: 'ceph', exclude: false, options: { ssd: true, discard: false } },
      { storage: 'ceph', exclude: true, options: { ssd: true } },
    ])).toEqual([{ index: 0, targetStorage: 'ceph', discard: false, ssd: true }, { index: 1, exclude: true }])
  })
})
