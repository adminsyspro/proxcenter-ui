import { describe, expect, it } from 'vitest'

import { getGuestOsLogo } from './osIcons'

describe('getGuestOsLogo', () => {
  it('uses the templates vendor logos, Windows in colour', () => {
    expect(getGuestOsLogo('Microsoft Windows Server 2022 (64-bit)')).toEqual({ src: '/images/vendors/windows.svg' })
    expect(getGuestOsLogo('Debian GNU/Linux 12 (64-bit)')).toEqual({ src: '/images/vendors/debian.svg' })
    expect(getGuestOsLogo('AlmaLinux (64-bit)')).toEqual({ src: '/images/vendors/alma.svg' })
    expect(getGuestOsLogo('Rocky Linux (64-bit)')).toEqual({ src: '/images/vendors/rocky.svg' })
    expect(getGuestOsLogo('SUSE Linux Enterprise 15 (64-bit)')).toEqual({ src: '/images/vendors/opensuse.svg' })
  })

  it('tints the monochrome OS icons, and has nothing for an unknown OS', () => {
    expect(getGuestOsLogo('Red Hat Enterprise Linux 9 (64-bit)')).toEqual({ src: '/images/os/redhat.svg', tint: '#EE0000' })
    expect(getGuestOsLogo('Other 3.x or later Linux (64-bit)')).toEqual({ src: '/images/os/linux.svg', tint: 'currentColor' })
    expect(getGuestOsLogo('Other (32-bit)')).toBeNull()
    expect(getGuestOsLogo(undefined)).toBeNull()
  })
})
