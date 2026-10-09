// Guest OS family from the QEMU guest agent `get-osinfo` answer. Shared by
// the guest info route and the guest file restore agent writer.

export type GuestOsType = 'linux' | 'windows' | 'other'

const LINUX_DISTROS = [
  'debian', 'ubuntu', 'centos', 'rhel', 'fedora', 'alpine', 'arch', 'opensuse', 'suse',
  'mint', 'manjaro', 'rocky', 'alma', 'oracle', 'gentoo', 'slackware', 'nixos',
]

export function getOsType(osInfo: any): GuestOsType {
  if (!osInfo) return 'other'

  const id = String(osInfo.id || '').toLowerCase()
  const name = String(osInfo.name || '').toLowerCase()

  if (id === 'mswindows' || name.includes('windows')) {
    return 'windows'
  }

  if (LINUX_DISTROS.some(d => id.includes(d) || name.includes(d)) || name.includes('linux')) {
    return 'linux'
  }

  return 'other'
}
