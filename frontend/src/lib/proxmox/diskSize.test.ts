import { describe, expect, it } from 'vitest'

import { GIB, guestDiskCapacity, parsePveSize, pveDriveSize } from './diskSize'

describe('parsePveSize', () => {
  it.each([
    ['528K', 528 * 1024],
    ['4M', 4 * 1024 ** 2],
    ['32G', 32 * GIB],
    ['2T', 2 * 1024 ** 4],
    ['1.5G', 1.5 * GIB],
    ['512MiB', 512 * 1024 ** 2],
    ['1048577', 1048577],
    [' 8g ', 8 * GIB],
  ])('reads %s', (size, bytes) => {
    expect(parsePveSize(size)).toBe(bytes)
  })

  it.each(['', 'bad', '12P', '-4G', 'G', undefined, null])('returns 0 for %s', size => {
    expect(parsePveSize(size)).toBe(0)
  })
})

describe('pveDriveSize', () => {
  it('reads the size option of an EFI disk in kilobytes (#1036)', () => {
    expect(pveDriveSize('local-lvm:vm-100-disk-0,efitype=4m,pre-enrolled-keys=1,size=528K')).toBe(528 * 1024)
  })

  it('reads the size option wherever it sits in the drive string', () => {
    expect(pveDriveSize('ceph:vm-111-disk-0,size=750G,ssd=1')).toBe(750 * GIB)
  })

  it('does not mistake another option ending in size for the size', () => {
    expect(pveDriveSize('local:vm-1-disk-0,blocksize=4096')).toBe(0)
  })

  it('returns 0 without a size option', () => {
    expect(pveDriveSize('none,media=cdrom')).toBe(0)
    expect(pveDriveSize(undefined)).toBe(0)
  })
})

describe('guestDiskCapacity', () => {
  it('sums every configured QEMU disk, including firmware devices', () => {
    expect(guestDiskCapacity({
      scsi0: 'local-lvm:vm-100-disk-0,size=50G',
      virtio1: 'local-lvm:vm-100-disk-1,size=50G',
      ide2: 'local:iso/debian.iso,media=cdrom',
      efidisk0: 'local-lvm:vm-100-disk-2,size=528K',
      tpmstate0: 'local-lvm:vm-100-disk-3,size=4M',
      unused0: 'local-lvm:vm-100-disk-4,size=10G',
    }, 'qemu')).toBe(100 * GIB + 528 * 1024 + 4 * 1024 ** 2)
  })

  it('sums the root filesystem and mount points for an LXC', () => {
    expect(guestDiskCapacity({
      rootfs: 'local-lvm:vm-200-disk-0,size=8G',
      mp0: 'local:subvol-200-disk-1,size=20G',
      unused0: 'local:subvol-200-disk-2,size=40G',
    }, 'lxc')).toBe(28 * GIB)
  })

  it('returns null when config contains no parseable disk sizes', () => {
    expect(guestDiskCapacity({ ide2: 'none,media=cdrom' }, 'qemu')).toBeNull()
    expect(guestDiskCapacity(null, 'qemu')).toBeNull()
  })
})
