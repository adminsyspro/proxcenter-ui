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
