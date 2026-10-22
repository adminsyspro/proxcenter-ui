/**
 * Which Windows releases the node's virt-v2v can install the VirtIO drivers in
 * (#1173). Client-safe: the migration dialog uses it for its warning, the
 * engine for the reason it logs.
 *
 * virt-v2v picks the drivers on the virtio-win ISO by matching the guest's
 * libosinfo id (`win2k25`) with a directory name (`2k25`), and that table is
 * compiled in. virt-v2v 2.6.0, the one Debian 13 and PVE 9 ship, predates
 * Windows Server 2025 (added upstream in libguestfs-common 2d42128e, first in
 * virt-v2v 2.7.2): it finds nothing for it on an ISO that holds the drivers,
 * exits 0 and leaves the guest on emulated devices (measured on the lab).
 *
 * The version alone does not tell: a 2.6.0 rebuilt with that backport
 * (virt-v2v-backport.ts) still prints 2.6.0. The directory name of a release is a string
 * of the binary only when the table has it, so the node probe looks for it
 * there (`VIRT_V2V_MARKERS`) and the version is only quoted.
 */

export interface UnsupportedWindows {
  /** "Windows Server 2025" */
  release: string
  /** Oldest upstream virt-v2v that knows it. */
  minVersion: string
}

/** What the node probe found out about its virt-v2v. */
export interface VirtV2vSupport {
  /** "2.6.0", as `virt-v2v-in-place --version` prints it. */
  version?: string
  /** The markers of `VIRT_V2V_MARKERS` found in the binary; absent when the probe did not look. */
  knows?: string[]
  /** ProxCenter's virt-v2v build that knows them can be installed on the node (virt-v2v-backport.ts). */
  backport?: boolean
}

const RELEASES: { release: string; marker: string; osinfo: RegExp; name: RegExp; minVersion: string }[] = [
  { release: "Windows Server 2025", marker: "2k25", osinfo: /\bwin2k25\b/i, name: /windows\s+server\s+2025/i, minVersion: "2.7.2" },
]

/** The virtio-win directory names the node probe looks for in the virt-v2v binary. */
export const VIRT_V2V_MARKERS = RELEASES.map(r => r.marker)

/**
 * The Windows release this virt-v2v cannot convert, when `guest` names one:
 * the source's OS name ("Microsoft Windows Server 2025 (64-bit)") or the
 * libosinfo id virt-v2v printed ("win2k25"). Null when the probe did not
 * look: the engine still runs the conversion and reads its outcome.
 */
export function windowsUnsupportedByVirtV2v(guest: string | undefined, node: VirtV2vSupport | undefined): UnsupportedWindows | null {
  if (!guest || !node?.knows) return null
  const r = RELEASES.find(x => x.name.test(guest) || x.osinfo.test(guest))
  if (!r || node.knows.includes(r.marker)) return null
  return { release: r.release, minVersion: r.minVersion }
}

/**
 * One view of several nodes' virt-v2v, for a migration that may land on any
 * of them (the cold dialog's Auto node): a release counts as known only when
 * every node knows it, the backport as available when one node takes it.
 */
export function mergeVirtV2vSupport(nodes: (VirtV2vSupport | undefined)[]): VirtV2vSupport | undefined {
  const probed = nodes.filter((n): n is VirtV2vSupport => !!n)
  if (probed.length === 0 || probed.length < nodes.length) return undefined
  const version = probed.find(n => n.version)?.version
  const knows = probed.every(n => n.knows) ? VIRT_V2V_MARKERS.filter(m => probed.every(n => n.knows?.includes(m))) : undefined
  return { ...(version && { version }), ...(knows && { knows }), ...(probed.some(n => n.backport) && { backport: true }) }
}

/** Why the conversion is not applied, for the job log: the node's virt-v2v, never the ISO. */
export function unsupportedWindowsReason(u: UnsupportedWindows, virtV2vVersion: string | undefined): string {
  const which = virtV2vVersion ? `virt-v2v ${virtV2vVersion}` : "virt-v2v"
  return `${which} on this node does not support ${u.release} (support starts with virt-v2v ${u.minVersion}): it installs no VirtIO driver in this guest, although the VirtIO ISO holds them. After the first boot, install virtio-win-guest-tools.exe from the VirtIO ISO in the guest, then move its disks to VirtIO SCSI and its NICs to VirtIO`
}
