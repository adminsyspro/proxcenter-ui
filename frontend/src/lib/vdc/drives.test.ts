import { describe, expect, it } from 'vitest'

import {
  isTenantDiskKey, parseDriveString, validateDriveAgainstScope,
  stampDriveQos, policyQosSuffix, QOS_KEYS,
} from './drives'

const scope = new Set(['ceph-nvme', 'ceph-hdd'])
const gold = { iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

describe('parseDriveString', () => {
  it('parses a new allocation storage:size', () => {
    const r = parseDriveString('ceph-nvme:32')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.drive.storage).toBe('ceph-nvme')
      expect(r.drive.newAllocationGb).toBe(32)
    }
  })
  it('parses a volume reference with options', () => {
    const r = parseDriveString('ceph-nvme:vm-100-disk-0,size=32G,iothread=1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.drive.storage).toBe('ceph-nvme')
      expect(r.drive.newAllocationGb).toBeNull()
      expect(r.drive.opts).toEqual([['size', '32G'], ['iothread', '1']])
    }
  })
  it('flags cdrom entries', () => {
    const r = parseDriveString('local:iso/debian.iso,media=cdrom')
    expect(r.ok && r.drive.isCdrom).toBe(true)
  })
  it('accepts bare none', () => {
    const r = parseDriveString('none,media=cdrom')
    expect(r.ok && r.drive.storage === null).toBe(true)
  })
  it('refuses a raw device path (host passthrough)', () => {
    expect(parseDriveString('/dev/disk/by-id/ata-Foo').ok).toBe(false)
  })
  it('refuses a duplicate option key', () => {
    expect(parseDriveString('ceph-nvme:32,iops_rd=100,iops_rd=9999').ok).toBe(false)
  })
  it('refuses uppercase option keys (PVE rejects them, fail-closed)', () => {
    expect(parseDriveString('ceph-nvme:32,IOPS_RD=9999').ok).toBe(false)
  })
  it('refuses an option without =', () => {
    expect(parseDriveString('ceph-nvme:32,iothread').ok).toBe(false)
  })
})

describe('validateDriveAgainstScope', () => {
  it('accepts an in-scope new allocation', () => {
    expect(validateDriveAgainstScope('scsi0', 'ceph-nvme:32', scope).ok).toBe(true)
  })
  it('refuses an out-of-scope storage, naming it', () => {
    const r = validateDriveAgainstScope('scsi0', 'local-lvm:32', scope)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('local-lvm')
  })
  it('refuses an out-of-scope volume reference (unusedN reassign)', () => {
    expect(validateDriveAgainstScope('unused0', 'local-lvm:vm-100-disk-3', scope).ok).toBe(false)
  })
  it('validates the import-from volid storage too', () => {
    const r = validateDriveAgainstScope('scsi0', 'ceph-nvme:0,import-from=local:import/img.qcow2', scope)
    expect(r.ok).toBe(false)
  })
  it('refuses a non-volid import-from (host path)', () => {
    expect(validateDriveAgainstScope('scsi0', 'ceph-nvme:0,import-from=/root/x.qcow2', scope).ok).toBe(false)
  })
  it('lets none,media=cdrom through', () => {
    expect(validateDriveAgainstScope('ide2', 'none,media=cdrom', scope).ok).toBe(true)
  })
})

describe('stampDriveQos', () => {
  it('strips every tenant QoS key then stamps the policy caps', () => {
    const out = stampDriveQos('ceph-nvme:32,iops_rd=99999,mbps=10000,iops_rd_max=1,iothread=1', gold)
    expect(out).toBe('ceph-nvme:32,iothread=1,iops_rd=5000,iops_wr=4000,mbps_rd=500')
  })
  it('omits null caps entirely', () => {
    const out = stampDriveQos('ceph-nvme:32', gold)
    expect(out).not.toContain('mbps_wr')
  })
  it('is a no-op without a policy', () => {
    expect(stampDriveQos('ceph-hdd:32,iops_rd=100', undefined)).toBe('ceph-hdd:32,iops_rd=100')
  })
  it('never stamps a cdrom line', () => {
    expect(stampDriveQos('local:iso/x.iso,media=cdrom', gold)).toBe('local:iso/x.iso,media=cdrom')
  })
  it('QOS_KEYS carries the full 15-key family', () => {
    expect(QOS_KEYS.size).toBe(15)
    expect(QOS_KEYS.has('iops_rd_max_length')).toBe(true)
  })
})

describe('isTenantDiskKey', () => {
  it.each([
    ['scsi0', 'qemu', true], ['virtio3', 'qemu', true], ['unused0', 'qemu', true],
    ['efidisk0', 'qemu', true], ['tpmstate0', 'qemu', true], ['net0', 'qemu', false],
    ['rootfs', 'lxc', true], ['mp2', 'lxc', true], ['scsi0', 'lxc', false],
  ] as const)('%s/%s -> %s', (key, type, want) => {
    expect(isTenantDiskKey(key, type)).toBe(want)
  })
})
