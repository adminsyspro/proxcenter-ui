/**
 * Maps OS names to SVG icon paths in /images/os/
 */

const OS_ICON_MAP: [string[], string][] = [
  [['ubuntu'], '/images/os/ubuntu.svg'],
  [['debian', 'devuan'], '/images/os/debian.svg'],
  [['fedora'], '/images/os/fedora.svg'],
  [['centos', 'rocky', 'alma'], '/images/os/centos.svg'],
  [['redhat', 'rhel', 'red hat'], '/images/os/redhat.svg'],
  [['suse', 'opensuse'], '/images/os/suse.svg'],
  [['alpine'], '/images/os/alpine.svg'],
  [['arch'], '/images/os/arch.svg'],
  [['freebsd', 'bsd'], '/images/os/freebsd.svg'],
  [['windows'], '/images/os/windows.svg'],
]

const LINUX_FALLBACK = '/images/os/linux.svg'

/**
 * Returns the SVG icon path for a given OS name.
 * Falls back to generic linux.svg for unknown Linux distros, or null if unknown.
 */
export function getOsSvgIcon(osName: string, osType?: string): string | null {
  const l = (osName || '').toLowerCase()

  for (const [keywords, icon] of OS_ICON_MAP) {
    if (keywords.some(k => l.includes(k))) return icon
  }

  if (osType === 'linux' || l.includes('linux')) return LINUX_FALLBACK

  return null
}

// The distribution logos of /automation/templates (public/images/vendors), the
// brand marks users already see there; Alma and Rocky keep their own logo.
// Windows uses the coloured four-pane logo (blue), not the monochrome one.
const VENDOR_LOGO_MAP: [string[], string][] = [
  [['windows'], '/images/vendors/windows.svg'],
  [['ubuntu'], '/images/vendors/ubuntu.svg'],
  [['debian'], '/images/vendors/debian.svg'],
  [['rocky'], '/images/vendors/rocky.svg'],
  [['alma'], '/images/vendors/alma.svg'],
  [['fedora'], '/images/vendors/fedora.svg'],
  [['suse'], '/images/vendors/opensuse.svg'],
  [['alpine'], '/images/vendors/alpine.svg'],
  [['arch linux', 'archlinux'], '/images/vendors/arch.svg'],
  [['centos'], '/images/vendors/centos.png'],
  [['freebsd'], '/images/vendors/freebsd.png'],
]

// The /images/os icons are drawn in currentColor: as an <img> they come out
// black, so they are painted through a mask in their brand colour instead.
const MONO_TINTS: Record<string, string> = { '/images/os/redhat.svg': '#EE0000' }

export interface GuestOsLogo {
  src: string
  /** Paint the (monochrome) icon in this colour; absent for a coloured logo. */
  tint?: string
}

/**
 * Logo for a guest OS as a hypervisor names it ("Debian GNU/Linux 12 (64-bit)",
 * "Microsoft Windows Server 2022 (64-bit)"): the templates' vendor logo when
 * there is one, else the generic OS icon (Red Hat, Linux) to tint, else null.
 */
export function getGuestOsLogo(guestOs: string | undefined | null): GuestOsLogo | null {
  const l = (guestOs || '').toLowerCase()
  if (!l) return null
  for (const [keywords, logo] of VENDOR_LOGO_MAP) {
    if (keywords.some(k => l.includes(k))) return { src: logo }
  }
  const mono = getOsSvgIcon(l)
  return mono ? { src: mono, tint: MONO_TINTS[mono] || 'currentColor' } : null
}
