import { describe, expect, it } from 'vitest'
import { isCdromMediaChange, isOpticalDrive, replaceCdromMedia } from './cdrom'

const empty = 'none,media=cdrom'

describe('optical drive detection', () => {
  it('recognises optical drives by their media flag and nothing else', () => {
    expect(isOpticalDrive(empty)).toBe(true)
    expect(isOpticalDrive('cdrom')).toBe(true)
    expect(isOpticalDrive('local:iso/debian.iso,media=cdrom,size=1G')).toBe(true)
    expect(isOpticalDrive('local:vm-100-disk-0,size=32G')).toBe(false)
    expect(isOpticalDrive('local:iso/x.iso,xmedia=cdrom')).toBe(false)
    expect(isOpticalDrive(undefined)).toBe(false)
  })

  it('keeps ISO names PVE accepts editable, whatever characters they carry', () => {
    for (const name of ["Fedora & Friends (x64).iso", "O'Reilly Live.iso", 'Édition Éducation.iso', 'win+tools#1.iso']) {
      const mounted = `local:iso/${name},media=cdrom`
      expect(isCdromMediaChange(empty, mounted), name).toBe(true)
      expect(isCdromMediaChange(mounted, empty), name).toBe(true)
      expect(replaceCdromMedia(`${mounted},size=4G`, 'none')).toBe('none,media=cdrom')
    }
  })

  it('still refuses path tricks, separators and duplicate options', () => {
    expect(isCdromMediaChange(empty, 'local:iso/../vm-200-disk-0,media=cdrom')).toBe(false)
    expect(isCdromMediaChange(empty, 'local:iso/a.iso,media=cdrom,media=disk')).toBe(false)
    expect(isCdromMediaChange(empty, '/dev/sr0,media=cdrom')).toBe(false)
    expect(() => replaceCdromMedia(empty, 'local:iso/a.iso,cache=writeback')).toThrow(/Invalid/)
    expect(() => replaceCdromMedia(empty, 'local:iso/../secret')).toThrow(/Invalid/)
  })

  it('treats vm-<vmid>-cloudinit as a device, and cloudinit.iso as ordinary media', () => {
    expect(isOpticalDrive('local:vm-100-cloudinit,media=cdrom')).toBe(false)
    expect(isCdromMediaChange('local:vm-100-cloudinit,media=cdrom', empty)).toBe(false)
    expect(isOpticalDrive('local:iso/cloudinit.iso,media=cdrom')).toBe(true)
    expect(isCdromMediaChange('local:iso/cloudinit.iso,media=cdrom', empty)).toBe(true)
  })
})
