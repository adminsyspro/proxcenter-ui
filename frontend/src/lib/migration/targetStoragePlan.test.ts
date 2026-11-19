/**
 * #1402: PVE drops a target storage without a word for an HA-managed guest
 * (the request becomes `ha-manager migrate`, which carries none) and for the
 * volumes a replication job already holds on the target node. Measured on
 * PVE 9.2.26.
 */
import { describe, expect, it } from 'vitest'

import { describeTargetStoragePlan, targetStoragePlan, type TargetStoragePlanInput } from './targetStoragePlan'

const storages: TargetStoragePlanInput['storages'] = {
  'ZFS-Pool': { type: 'zfspool' },
  'local-lvm': { type: 'lvmthin' },
  ceph: { type: 'rbd' },
  iscsi: { type: 'lvm', shared: 1 },
  'iscsi-pve2': { type: 'lvm', shared: 1, nodes: 'pve2,pve3' },
}

function run(over: Partial<TargetStoragePlanInput>) {
  return targetStoragePlan({
    guestType: 'qemu',
    running: true,
    sourceNode: 'pve1',
    targetNode: 'pve2',
    targetStorage: 'iscsi',
    config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G' },
    storages,
    haManaged: false,
    replicationTargets: [],
    ...over,
  })
}

describe('targetStoragePlan', () => {
  it('leaves a plain guest to PVE, which honours the target storage', () => {
    expect(run({})).toEqual({ kind: 'direct' })
  })

  it('has nothing to say when no target storage is asked for', () => {
    expect(run({ targetStorage: undefined, haManaged: true })).toEqual({ kind: 'direct' })
  })

  it('moves the local disks first for an HA guest going to shared storage (the #1402 case)', () => {
    expect(run({
      haManaged: true,
      config: {
        scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G',
        scsi1: 'local-lvm:vm-100-disk-1,size=8G',
        efidisk0: 'ZFS-Pool:vm-100-disk-2,efitype=4m,size=1M',
      },
    })).toEqual({
      kind: 'move-first',
      disks: [
        { id: 'efidisk0', volid: 'ZFS-Pool:vm-100-disk-2' },
        { id: 'scsi0', volid: 'ZFS-Pool:vm-100-disk-0' },
        { id: 'scsi1', volid: 'local-lvm:vm-100-disk-1' },
      ],
    })
  })

  it('skips what a migration never remaps: shared disks, CD-ROMs, disks already on the target storage', () => {
    expect(run({
      haManaged: true,
      config: {
        scsi0: 'ceph:vm-100-disk-0,size=32G',
        scsi1: 'iscsi:vm-100-disk-1,size=8G',
        ide2: 'local-lvm:vm-100-cloudinit,media=cdrom',
        net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0',
      },
    })).toEqual({ kind: 'direct' })
  })

  it('refuses an HA guest whose target storage is local to a node', () => {
    expect(run({ haManaged: true, targetStorage: 'local-lvm' })).toEqual({
      kind: 'blocked',
      reason: 'ha-target-not-shared',
      volids: ['ZFS-Pool:vm-100-disk-0'],
    })
  })

  it('refuses an HA guest whose shared target storage is not on the source node', () => {
    expect(run({ haManaged: true, targetStorage: 'iscsi-pve2' })).toMatchObject({
      kind: 'blocked',
      reason: 'ha-target-not-shared',
    })
  })

  it('refuses a running HA container: PVE cannot move the volumes of a running container', () => {
    expect(run({
      guestType: 'lxc',
      haManaged: true,
      config: { rootfs: 'ZFS-Pool:subvol-100-disk-0,size=8G' },
    })).toEqual({
      kind: 'blocked',
      reason: 'ha-running-container',
      volids: ['ZFS-Pool:subvol-100-disk-0'],
    })
  })

  it('moves the volumes of a stopped HA container first', () => {
    expect(run({
      guestType: 'lxc',
      running: false,
      haManaged: true,
      config: { rootfs: 'ZFS-Pool:subvol-100-disk-0,size=8G', mp0: 'ZFS-Pool:subvol-100-disk-1,mp=/data,size=4G' },
    })).toEqual({
      kind: 'move-first',
      disks: [
        { id: 'mp0', volid: 'ZFS-Pool:subvol-100-disk-1' },
        { id: 'rootfs', volid: 'ZFS-Pool:subvol-100-disk-0' },
      ],
    })
  })

  it('refuses a running HA VM with a local TPM state, which PVE only moves offline', () => {
    expect(run({
      haManaged: true,
      config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G', tpmstate0: 'ZFS-Pool:vm-100-disk-1,size=4M,version=v2.0' },
    })).toEqual({
      kind: 'blocked',
      reason: 'ha-tpm-running',
      volids: ['ZFS-Pool:vm-100-disk-1'],
    })
  })

  it('moves the TPM state with the rest once the HA VM is stopped', () => {
    const plan = run({
      running: false,
      haManaged: true,
      config: { scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G', tpmstate0: 'ZFS-Pool:vm-100-disk-1,size=4M,version=v2.0' },
    })
    expect(plan.kind).toBe('move-first')
  })

  it('refuses when the disks are replicated to the target node: PVE re-uses the replica there', () => {
    expect(run({ replicationTargets: ['pve2'] })).toEqual({
      kind: 'blocked',
      reason: 'replicated',
      volids: ['ZFS-Pool:vm-100-disk-0'],
    })
  })

  it('lets a disk the job does not carry follow the target storage', () => {
    expect(run({
      replicationTargets: ['pve2'],
      config: { scsi0: 'ZFS-Pool:vm-100-disk-0,replicate=0,size=32G', scsi1: 'local-lvm:vm-100-disk-1,size=8G' },
    })).toEqual({ kind: 'direct' })
  })

  it('leaves a guest replicated to another node to PVE', () => {
    expect(run({ replicationTargets: ['pve3'] })).toEqual({ kind: 'direct' })
  })

  it('never moves a replicated disk off its storage for an HA guest, whatever the replication target', () => {
    expect(run({ haManaged: true, replicationTargets: ['pve3'] })).toEqual({
      kind: 'blocked',
      reason: 'replicated',
      volids: ['ZFS-Pool:vm-100-disk-0'],
    })
  })
})

describe('describeTargetStoragePlan', () => {
  it('names the disks to move and the storage', () => {
    const text = describeTargetStoragePlan(run({ haManaged: true }), 'iscsi')
    expect(text).toContain('scsi0')
    expect(text).toContain('iscsi')
    expect(text).toContain('HA')
  })

  it('explains each refusal', () => {
    for (const over of [
      { haManaged: true, targetStorage: 'local-lvm' },
      { haManaged: true, guestType: 'lxc' as const, config: { rootfs: 'ZFS-Pool:subvol-100-disk-0,size=8G' } },
      { replicationTargets: ['pve2'] },
    ]) {
      const plan = run(over)
      expect(describeTargetStoragePlan(plan, over.targetStorage ?? 'iscsi')).toContain('ZFS-Pool:')
    }
  })

  it('says nothing for a direct migration', () => {
    expect(describeTargetStoragePlan({ kind: 'direct' }, 'iscsi')).toBe('')
  })
})
