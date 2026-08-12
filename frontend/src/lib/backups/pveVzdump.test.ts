import { describe, it, expect } from 'vitest'

import { parseVzdumpVolidTime, vzdumpBackupTypeFromVolid } from './pveVzdump'

describe('parseVzdumpVolidTime', () => {
  it('extracts the timestamp encoded in a vzdump filename', () => {
    const t = parseVzdumpVolidTime('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')
    expect(t).not.toBeNull()
    expect(new Date(t! * 1000).toISOString()).toBe('2026-08-11T15:51:33.000Z')
  })

  it('returns null when the volid carries no date', () => {
    expect(parseVzdumpVolidTime('local:backup/whatever.vma.zst')).toBeNull()
  })
})

describe('vzdumpBackupTypeFromVolid', () => {
  it('maps qemu archives to vm', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')).toBe('vm')
  })

  it('maps lxc archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-lxc-200-2026_08_11-15_51_33.tar.zst')).toBe('ct')
  })

  it('maps legacy openvz archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-openvz-200-2026_08_11-15_51_33.tar.lzo')).toBe('ct')
  })

  it('returns null for a non-vzdump volid', () => {
    expect(vzdumpBackupTypeFromVolid('local:iso/debian.iso')).toBeNull()
  })
})
