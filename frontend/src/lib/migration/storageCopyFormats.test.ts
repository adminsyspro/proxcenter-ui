import { describe, expect, it } from 'vitest'

import { offlineCopyFormatMismatch } from './storageCopyFormats'

describe('offlineCopyFormatMismatch', () => {
  it.each([
    ['rbd', 'zfspool'],
    ['zfspool', 'rbd'],
    ['zfspool', 'lvmthin'],
    ['nfs', 'zfspool'],
    ['rbd', 'iscsidirect'],
  ])('refuses a %s disk copied offline to a %s storage', (source, target) => {
    expect(offlineCopyFormatMismatch(source, target)).toBe(true)
  })

  it.each([
    ['rbd', 'rbd'],
    ['rbd', 'lvmthin'],
    ['lvm', 'nfs'],
    ['zfspool', 'zfspool'],
    ['dir', 'cifs'],
    ['btrfs', 'rbd'],
  ])('lets a %s disk be copied offline to a %s storage', (source, target) => {
    expect(offlineCopyFormatMismatch(source, target)).toBe(false)
  })

  it('does not judge a storage type it does not know', () => {
    expect(offlineCopyFormatMismatch('pbs', 'zfspool')).toBe(false)
    expect(offlineCopyFormatMismatch('rbd', 'some-plugin')).toBe(false)
    expect(offlineCopyFormatMismatch(undefined, 'zfspool')).toBe(false)
  })
})
