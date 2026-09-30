/**
 * #1027: the snapshot branch of PVE 9.2.11's volume scan, so the migrate
 * dialog and route refuse exactly what PVE would abort with "check log".
 */
import { describe, expect, it } from 'vitest'

import { snapshotMigrationBlockers, snapshotsToClear, type SnapshotMigrationInput } from './snapshotMigrationBlockers'

const storages: SnapshotMigrationInput['storages'] = {
  'ZFS-Pool': { type: 'zfspool' },
  'local-lvm': { type: 'lvmthin' },
  local: { type: 'dir' },
  chain: { type: 'dir', 'snapshot-as-volume-chain': 1 },
  bt: { type: 'btrfs' },
  ceph: { type: 'rbd' },
  nfs: { type: 'nfs', shared: 1 },
}

function run(over: Partial<SnapshotMigrationInput>) {
  return snapshotMigrationBlockers({
    guestType: 'qemu',
    live: false,
    storages,
    snapshots: [{ name: 'before-upgrade', config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G' } }],
    ...over,
  })
}

describe('snapshotMigrationBlockers', () => {
  it('blocks a live migration of a ZFS disk held by a snapshot (the #1027 case)', () => {
    expect(run({ live: true })).toEqual([
      { volid: 'ZFS-Pool:vm-100-disk-0', storage: 'ZFS-Pool', snapshots: ['before-upgrade'], reason: 'live' },
    ])
  })

  it('lets the same ZFS disk migrate offline, snapshots included', () => {
    expect(run({ live: false })).toEqual([])
  })

  it('accepts the live migration when the volume is replicated to the target', () => {
    expect(run({ live: true, replicatedVolids: new Set(['ZFS-Pool:vm-100-disk-0']) })).toEqual([])
  })

  it('blocks LVM-thin even offline, since no snapshot can leave it', () => {
    const snapshots = [{ name: 's1', config: { scsi0: 'local-lvm:vm-100-disk-0,size=8G' } }]
    expect(run({ snapshots }).map(b => b.reason)).toEqual(['storage'])
  })

  it('carries in-qcow2 snapshots offline but not volume-chain ones', () => {
    const snapshots = [{ name: 's1', config: {
      scsi0: 'local:100/vm-100-disk-0.qcow2,size=8G',
      scsi1: 'chain:100/vm-100-disk-1.qcow2,size=8G',
    } }]
    expect(run({ snapshots })).toEqual([
      { volid: 'chain:100/vm-100-disk-1.qcow2', storage: 'chain', snapshots: ['s1'], reason: 'storage' },
    ])
  })

  it('carries btrfs raw but not a raw file on a dir storage', () => {
    const snapshots = [{ name: 's1', config: {
      scsi0: 'bt:100/vm-100-disk-0.raw,size=8G',
      scsi1: 'local:100/vm-100-disk-1.raw,size=8G',
    } }]
    expect(run({ snapshots }).map(b => b.volid)).toEqual(['local:100/vm-100-disk-1.raw'])
  })

  it('ignores shared storages, CD-ROMs, vmstate and unused entries', () => {
    const snapshots = [{ name: 's1', config: {
      scsi0: 'ceph:vm-100-disk-0,size=8G',
      scsi1: 'nfs:100/vm-100-disk-1.raw,size=8G',
      ide2: 'local:iso/debian.iso,media=cdrom',
      vmstate: 'local-lvm:vm-100-state-s1',
      unused0: 'local-lvm:vm-100-disk-9',
    } }]
    expect(run({ live: true, snapshots })).toEqual([])
  })

  it('leaves an unknown storage to PVE instead of guessing', () => {
    const snapshots = [{ name: 's1', config: { scsi0: 'gone:vm-100-disk-0,size=8G' } }]
    expect(run({ snapshots })).toEqual([])
  })

  it('refuses a ZFS volume with snapshots sent to another storage type', () => {
    expect(run({ targetStorage: 'local-lvm' }).map(b => b.reason)).toEqual(['target'])
    expect(run({ targetStorage: 'ZFS-Pool' })).toEqual([])
  })

  it('applies the LXC rule: zfspool and btrfs only, no live mode, bind mounts skipped', () => {
    const snapshots = [{ name: 's1', config: {
      rootfs: 'ZFS-Pool:subvol-200-disk-0,size=8G',
      mp0: 'local-lvm:vm-200-disk-1,mp=/data,size=8G',
      mp1: '/srv/share,mp=/share',
    } }]
    expect(run({ guestType: 'lxc', live: true, snapshots })).toEqual([
      { volid: 'local-lvm:vm-200-disk-1', storage: 'local-lvm', snapshots: ['s1'], reason: 'storage' },
    ])
  })

  it('lists every snapshot holding a volume, once, to delete them together', () => {
    const snapshots = [
      { name: 'a', config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=8G', scsi1: 'local-lvm:vm-100-disk-1,size=8G' } },
      { name: 'b', config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=8G' } },
      { name: 'current', config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=8G' } },
    ]
    const blockers = run({ live: true, snapshots })
    expect(blockers.find(b => b.storage === 'ZFS-Pool')?.snapshots).toEqual(['a', 'b'])
    expect(snapshotsToClear(blockers)).toEqual(['a', 'b'])
  })
})
