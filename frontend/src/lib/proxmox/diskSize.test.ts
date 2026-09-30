import { describe, expect, it } from 'vitest'

import { GIB, parsePveSize, pveDriveSize } from './diskSize'

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
