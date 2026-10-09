import { describe, expect, it } from 'vitest'

import {
  guestDirname,
  guestTargetPath,
  innerPathOf,
  isRestorableItemPath,
  isSafeRelPath,
  joinGuestPath,
  keepBothCandidates,
  splitArchivePath,
  toWindowsPath,
  withCounter,
} from './paths'

const defaults = { linux: '/var/tmp/proxcenter-restore', windows: 'C:\\ProxCenter-Restore' }

describe('splitArchivePath', () => {
  it('splits a pxar path after the archive', () => {
    expect(splitArchivePath('/root.pxar.didx/etc/hosts')).toEqual({ volumeRoot: '/root.pxar.didx', inner: '/etc/hosts' })
  })
  it('splits a partition path after three segments', () => {
    expect(splitArchivePath('/drive-scsi0.img.fidx/part/1/etc/apt')).toEqual({
      volumeRoot: '/drive-scsi0.img.fidx/part/1',
      inner: '/etc/apt',
    })
  })
  it('splits an LVM path after four segments', () => {
    expect(splitArchivePath('/drive-scsi0.img.fidx/lvm/vg0/root/var/log')).toEqual({
      volumeRoot: '/drive-scsi0.img.fidx/lvm/vg0/root',
      inner: '/var/log',
    })
  })
  it('treats any other image kind as three segments', () => {
    expect(splitArchivePath('/drive-scsi0.img.fidx/zfs/rpool/home')).toEqual({
      volumeRoot: '/drive-scsi0.img.fidx/zfs/rpool',
      inner: '/home',
    })
  })
  it('yields the root when the path stops at the archive', () => {
    expect(splitArchivePath('/drive-scsi0.img.fidx/part/1')).toEqual({ volumeRoot: '/drive-scsi0.img.fidx/part/1', inner: '/' })
    expect(splitArchivePath('/root.pxar.didx')).toEqual({ volumeRoot: '/root.pxar.didx', inner: '/' })
  })
  it('keeps an unknown path whole', () => {
    expect(splitArchivePath('/etc/hosts')).toEqual({ volumeRoot: '', inner: '/etc/hosts' })
    expect(splitArchivePath('')).toEqual({ volumeRoot: '', inner: '/' })
  })
})

describe('innerPathOf', () => {
  it('normalises a pbs path and strips the archive of a pve path', () => {
    expect(innerPathOf('pbs', 'etc//apt/')).toBe('/etc/apt')
    expect(innerPathOf('pve', '/root.pxar.didx/etc/apt')).toBe('/etc/apt')
  })
})

describe('joinGuestPath / toWindowsPath', () => {
  it('joins posix paths', () => {
    expect(joinGuestPath('linux', '/etc', 'apt/sources.list')).toBe('/etc/apt/sources.list')
    expect(joinGuestPath('linux', '/', 'hosts')).toBe('/hosts')
    expect(joinGuestPath('linux', '/var/tmp/', '')).toBe('/var/tmp')
  })
  it('joins windows paths with backslashes', () => {
    expect(joinGuestPath('windows', 'C:\\', 'Users/x/a.txt')).toBe('C:\\Users\\x\\a.txt')
    expect(joinGuestPath('windows', 'C:\\Restore', 'etc/hosts')).toBe('C:\\Restore\\etc\\hosts')
    expect(joinGuestPath('windows', 'D:', 'x')).toBe('D:\\x')
  })
  it('maps a posix path onto a drive', () => {
    expect(toWindowsPath('/Windows/System32/drivers/etc', 'c')).toBe('C:\\Windows\\System32\\drivers\\etc')
    expect(toWindowsPath('/')).toBe('C:\\')
  })
})

describe('guestTargetPath', () => {
  it('restores to the original location on linux', () => {
    expect(
      guestTargetPath({
        os: 'linux',
        destination: { mode: 'original' },
        sourceKind: 'pve',
        itemPath: '/drive-scsi0.img.fidx/part/1/etc/apt',
        relPath: 'apt/sources.list',
        defaults,
      }),
    ).toBe('/etc/apt/sources.list')
  })
  it('restores a single file to its original directory', () => {
    expect(
      guestTargetPath({
        os: 'linux',
        destination: { mode: 'original' },
        sourceKind: 'pbs',
        itemPath: '/etc/hosts',
        relPath: 'hosts',
        defaults,
      }),
    ).toBe('/etc/hosts')
  })
  it('restores to the original location on windows, on the chosen drive', () => {
    expect(
      guestTargetPath({
        os: 'windows',
        destination: { mode: 'original', windowsDrive: 'd' },
        sourceKind: 'pve',
        itemPath: '/drive-scsi0.img.fidx/part/2/Users/bob/Documents',
        relPath: 'Documents/report.docx',
        defaults,
      }),
    ).toBe('D:\\Users\\bob\\Documents\\report.docx')
  })
  it('uses the custom folder, or the per-OS default when empty', () => {
    const base = { sourceKind: 'pve' as const, itemPath: '/root.pxar.didx/etc/apt', relPath: 'apt/x', defaults }
    expect(guestTargetPath({ ...base, os: 'linux', destination: { mode: 'custom', path: '/restore' } })).toBe('/restore/apt/x')
    expect(guestTargetPath({ ...base, os: 'linux', destination: { mode: 'custom' } })).toBe('/var/tmp/proxcenter-restore/apt/x')
    expect(guestTargetPath({ ...base, os: 'windows', destination: { mode: 'custom', path: '  ' } })).toBe('C:\\ProxCenter-Restore\\apt\\x')
  })
})

describe('keepBothCandidates / withCounter', () => {
  it('prefixes the name and then counts before the extension', () => {
    const it = keepBothCandidates('/etc/apt/sources.list', 'linux', 'RESTORED-')
    expect(it.next().value).toBe('/etc/apt/RESTORED-sources.list')
    expect(it.next().value).toBe('/etc/apt/RESTORED-sources-1.list')
    expect(it.next().value).toBe('/etc/apt/RESTORED-sources-2.list')
  })
  it('works with windows separators and dotfiles', () => {
    const it = keepBothCandidates('C:\\Users\\bob\\.bashrc', 'windows', 'RESTORED-')
    expect(it.next().value).toBe('C:\\Users\\bob\\RESTORED-.bashrc')
    expect(it.next().value).toBe('C:\\Users\\bob\\RESTORED-.bashrc-1')
    expect(withCounter('Makefile', 3)).toBe('Makefile-3')
  })
})

describe('guestDirname', () => {
  it('returns the parent on both OS', () => {
    expect(guestDirname('/etc/apt/sources.list', 'linux')).toBe('/etc/apt')
    expect(guestDirname('/hosts', 'linux')).toBe('/')
    expect(guestDirname('C:\\Users\\bob\\a.txt', 'windows')).toBe('C:\\Users\\bob')
    expect(guestDirname('C:\\a.txt', 'windows')).toBe('C:\\')
  })
})

describe('isSafeRelPath', () => {
  it('accepts plain relative paths only', () => {
    expect(isSafeRelPath('apt/sources.list')).toBe(true)
    expect(isSafeRelPath('/etc')).toBe(false)
    expect(isSafeRelPath('apt/../etc')).toBe(false)
    expect(isSafeRelPath('a\\b')).toBe(false)
    expect(isSafeRelPath('C:evil')).toBe(false)
    expect(isSafeRelPath('')).toBe(false)
  })
})

describe('isRestorableItemPath', () => {
  it('accepts entries inside a filesystem only', () => {
    expect(isRestorableItemPath('pve', '/drive-scsi0.img.fidx/part/1/etc')).toBe(true)
    expect(isRestorableItemPath('pve', '/root.pxar.didx/etc/hosts')).toBe(true)
    expect(isRestorableItemPath('pve', '/drive-scsi0.img.fidx/part/1')).toBe(false)
    expect(isRestorableItemPath('pve', '/drive-scsi0.img.fidx/part')).toBe(false)
    expect(isRestorableItemPath('pve', '/drive-scsi0.img.fidx')).toBe(false)
    expect(isRestorableItemPath('pve', '/drive-scsi0.img.fidx/lvm/vg0/root')).toBe(false)
    expect(isRestorableItemPath('pve', '/root.pxar.didx')).toBe(false)
    expect(isRestorableItemPath('pve', '/etc/hosts')).toBe(false)
    expect(isRestorableItemPath('pbs', '/etc')).toBe(true)
    expect(isRestorableItemPath('pbs', '/')).toBe(false)
  })
})
