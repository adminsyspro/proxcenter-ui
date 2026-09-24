import { describe, it, expect } from 'vitest'

import { volidOfDrive, snapshotsReferencingVolume } from './snapshotRefs'

describe('volidOfDrive', () => {
  it('takes the volume before the first option', () => {
    expect(volidOfDrive('local-lvm:vm-100-disk-0,size=32G,ssd=1')).toBe('local-lvm:vm-100-disk-0')
  })

  it('returns a bare unusedN value as is', () => {
    expect(volidOfDrive('jdss-pool-0:vm-10002-disk-0')).toBe('jdss-pool-0:vm-10002-disk-0')
  })

  it('reads an explicit file= or volume= key', () => {
    expect(volidOfDrive('file=ceph:vm-1-disk-0,size=8G')).toBe('ceph:vm-1-disk-0')
    expect(volidOfDrive('volume=local:subvol-1-disk-0,mp=/data')).toBe('local:subvol-1-disk-0')
  })

  it('returns null for an empty value', () => {
    expect(volidOfDrive('')).toBeNull()
    expect(volidOfDrive(undefined)).toBeNull()
  })
})

describe('snapshotsReferencingVolume', () => {
  const volid = 'local-lvm:vm-100-disk-0'

  it('lists the snapshots whose config still carries the volume on a drive', () => {
    const refs = snapshotsReferencingVolume(volid, [
      { name: 'before-upgrade', config: { scsi0: `${volid},size=32G`, memory: 2048 } },
      { name: 'other', config: { scsi0: 'local-lvm:vm-100-disk-1,size=32G' } },
    ])
    expect(refs).toEqual(['before-upgrade'])
  })

  it('does not count an unusedN entry: PVE neither copies nor checks those in a snapshot', () => {
    expect(snapshotsReferencingVolume(volid, [{ name: 's1', config: { unused0: volid } }])).toEqual([])
  })

  it('matches container rootfs and mount points', () => {
    const ct = 'local:subvol-200-disk-1'
    expect(snapshotsReferencingVolume(ct, [
      { name: 'a', config: { rootfs: `${ct},size=8G` } },
      { name: 'b', config: { mp0: `${ct},mp=/data` } },
    ])).toEqual(['a', 'b'])
  })

  it('ignores non-disk keys that happen to contain the volid', () => {
    expect(snapshotsReferencingVolume(volid, [
      { name: 's1', config: { description: volid, vmstate: volid } },
    ])).toEqual([])
  })

  it('skips the "current" pseudo-snapshot', () => {
    expect(snapshotsReferencingVolume(volid, [{ name: 'current', config: { scsi0: volid } }])).toEqual([])
  })
})
