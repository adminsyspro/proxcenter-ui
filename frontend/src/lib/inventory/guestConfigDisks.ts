/**
 * Total size of the disks attached to a guest, read from its config (#938).
 *
 * `/cluster/resources` reports `maxdisk` as the size of ONE disk: the boot
 * disk of a VM (PVE's bootdisk_size), the rootfs of a container. A VM with
 * several disks reads as its first one, and a VM whose boot order names no
 * disk (`boot: order=net0`, or a CD-ROM first) reads as 0. The config carries
 * a `size=` on every volume, so the sum comes from there.
 *
 * Pure and free of any server import: the guest detail panel (client) and
 * the inventory fan-out (server) both call it, and so can the inventory
 * reports.
 */
import { pveDriveSize } from "@/lib/proxmox/diskSize"

const QEMU_DRIVE_KEY = /^(?:scsi|virtio|ide|sata)\d+$/
const QEMU_SYSTEM_DRIVES = new Set(["efidisk0", "tpmstate0"])
const LXC_VOLUME_KEY = /^(?:rootfs|mp\d+)$/
const UNUSED_KEY = /^unused\d+$/

/**
 * A drive that takes no room on a guest storage: an empty slot, the host's
 * physical drive, or an ISO image (shared library content). A `media=cdrom`
 * drive backed by a disk volume (a cloud-init seed, or any images volume) is a
 * real volume and still counts: excluding every cdrom would let a volume hide
 * from the storage quota behind `media=cdrom`.
 */
function holdsNoGuestVolume(drive: string): boolean {
  const volume = drive.split(",")[0].trim()

  return volume === "none" || volume === "cdrom" || /:iso\//.test(volume) || /\.iso$/i.test(volume)
}

/**
 * Detached volumes (`unusedN`) of a guest config. They keep taking room on
 * their storage but carry no `size=`, so a quota check has to ask the storage
 * for their size.
 */
export function guestUnusedVolumes(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return []

  return Object.entries(config as Record<string, unknown>)
    .filter(([key, value]) => UNUSED_KEY.test(key) && typeof value === "string")
    .map(([, value]) => String(value).split(",")[0].trim())
    .filter(Boolean)
}

/** Config keys that hold a guest disk, for a `qemu` or `lxc` guest. `unusedN` is never one. */
export function isGuestDiskKey(key: string, type: string): boolean {
  if (type === "lxc") return LXC_VOLUME_KEY.test(key)

  return QEMU_DRIVE_KEY.test(key) || QEMU_SYSTEM_DRIVES.has(key)
}

/**
 * Sum, in bytes, of every disk attached to the guest. `null` when there is no
 * config to read (so a caller can keep a previous figure), 0 for a guest that
 * genuinely has no disk. Detached volumes (`unusedN`, sized separately by
 * guestUnusedVolumes for a quota), empty or ISO drives and bind mounts (no
 * `size=`) count for nothing here.
 */
export function sumGuestConfigDisks(config: unknown, type: string): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null

  let total = 0

  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (!isGuestDiskKey(key, type) || typeof value !== "string") continue
    if (type !== "lxc" && holdsNoGuestVolume(value)) continue
    total += pveDriveSize(value)
  }

  return total
}
