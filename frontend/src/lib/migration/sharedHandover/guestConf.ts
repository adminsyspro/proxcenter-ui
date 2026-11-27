/**
 * Reads and rewrites the raw configuration file of a guest
 * (/etc/pve/nodes/<node>/{qemu-server,lxc}/<vmid>.conf) for a cross-cluster
 * move without copy (ui#1460): the disks stay where they are, on a storage
 * both clusters reach, and only the file changes cluster.
 *
 * The file is handled as text on purpose. The API view of a configuration
 * drops the snapshot sections, the pending changes and the unused volumes,
 * and a container cannot be created over an existing root disk through the
 * API at all. Every line the move does not need to change is kept byte for
 * byte, so the guest keeps its identity (smbios uuid, vmgenid, MAC addresses).
 */

export type GuestType = 'qemu' | 'lxc'

/** One volume of the guest on a Proxmox storage. */
export type ConfVolume = {
  /** `main`, `PENDING`, `special:cloudinit` or the name of a snapshot. */
  section: string
  key: string
  storage: string
  volid: string
}

export type PortabilityBlocker = {
  section: string
  key: string
  /**
   * `passthrough`: a host disk or device path. `bind-mount`: a host directory
   * mounted into a container. `host-device`: a PCI, USB, serial or parallel
   * device of the node. `locked`: a Proxmox task holds the guest.
   */
  reason: 'passthrough' | 'bind-mount' | 'host-device' | 'locked'
}

export type InspectedGuestConf = {
  /** The disks to prove reachable from the target, every section included. */
  volumes: ConfVolume[]
  /** CD-ROM images: carried when their storage has a target, detached otherwise. */
  isos: ConfVolume[]
  /** The storages of `volumes`, each once, in the order they appear. */
  storages: string[]
  blockers: PortabilityBlocker[]
}

const MAIN = 'main'
const SECTION_RE = /^\[([^\]]+)\]\s*$/
const LINE_RE = /^([A-Za-z][\w.-]*):\s?(.*)$/
const VOLID_RE = /^([A-Za-z][\w.-]*):(.+)$/

const QEMU_DISK_RE = /^((ide|sata|scsi|virtio|unused)\d+|efidisk0|tpmstate0|vmstate)$/
const LXC_DISK_RE = /^(rootfs|(mp|unused)\d+)$/

type Line =
  | { kind: 'other'; text: string }
  | { kind: 'entry'; section: string; key: string; value: string; text: string }

function* readLines(raw: string): Generator<Line> {
  let section = MAIN
  for (const text of raw.split('\n')) {
    const header = SECTION_RE.exec(text)
    if (header) {
      section = header[1]
      yield { kind: 'other', text }
      continue
    }
    const entry = text.startsWith('#') ? null : LINE_RE.exec(text)
    yield entry ? { kind: 'entry', section, key: entry[1], value: entry[2], text } : { kind: 'other', text }
  }
}

/** A snapshot section describes a past state: only its volumes matter. */
function isCurrentSection(section: string): boolean {
  return section === MAIN || section === 'PENDING' || section.startsWith('special:')
}

/**
 * The volume a disk line points at, and where it sits among the comma
 * separated options: `<vol>,opt=…` or the key form `file=<vol>` / `volume=<vol>`.
 */
function locateVolume(value: string): { index: number; prefix: string; volume: string } {
  const tokens = value.split(',')
  if (!tokens[0].includes('=')) return { index: 0, prefix: '', volume: tokens[0] }
  const index = tokens.findIndex(t => t.startsWith('file=') || t.startsWith('volume='))
  if (index < 0) return { index: -1, prefix: '', volume: '' }
  const eq = tokens[index].indexOf('=') + 1

  return { index, prefix: tokens[index].slice(0, eq), volume: tokens[index].slice(eq) }
}

function isDiskKey(type: GuestType, key: string): boolean {
  return (type === 'qemu' ? QEMU_DISK_RE : LXC_DISK_RE).test(key)
}

function isIsoImage(value: string, volname: string): boolean {
  return /(^|,)media=cdrom(,|$)/.test(value) && volname.startsWith('iso/')
}

type DiskTarget =
  | { kind: 'none' }
  | { kind: 'blocked'; reason: PortabilityBlocker['reason'] }
  | { kind: 'volume' | 'iso'; storage: string; volid: string }

function classifyDisk(type: GuestType, value: string): DiskTarget {
  const { volume } = locateVolume(value)
  if (!volume || volume === 'none') return { kind: 'none' }
  if (volume === 'cdrom') return { kind: 'blocked', reason: 'host-device' }
  if (volume.startsWith('/')) return { kind: 'blocked', reason: type === 'lxc' ? 'bind-mount' : 'passthrough' }
  const parsed = VOLID_RE.exec(volume)
  if (!parsed) return { kind: 'none' }

  return { kind: isIsoImage(value, parsed[2]) ? 'iso' : 'volume', storage: parsed[1], volid: volume }
}

function hostDeviceBlocker(type: GuestType, key: string, value: string): PortabilityBlocker['reason'] | null {
  if (key === 'lock') return 'locked'
  if (type === 'lxc') {
    if (/^dev\d+$/.test(key)) return 'host-device'
    if (key === 'lxc.mount.entry') return 'bind-mount'

    return null
  }
  if (/^hostpci\d+$/.test(key)) return 'host-device'
  if (/^usb\d+$/.test(key) && !value.startsWith('spice')) return 'host-device'
  if (/^(serial|parallel)\d+$/.test(key) && value.startsWith('/dev/')) return 'host-device'

  return null
}

export function inspectGuestConf(raw: string, type: GuestType): InspectedGuestConf {
  const volumes: ConfVolume[] = []
  const isos: ConfVolume[] = []
  const blockers: PortabilityBlocker[] = []

  for (const line of readLines(raw)) {
    if (line.kind !== 'entry') continue
    const { section, key, value } = line
    const current = isCurrentSection(section)

    if (isDiskKey(type, key)) {
      const disk = classifyDisk(type, value)
      if (disk.kind === 'volume') volumes.push({ section, key, storage: disk.storage, volid: disk.volid })
      else if (disk.kind === 'iso' && current) isos.push({ section, key, storage: disk.storage, volid: disk.volid })
      else if (disk.kind === 'blocked' && current) blockers.push({ section, key, reason: disk.reason })
      continue
    }

    if (!current || (key === 'lock' && section !== MAIN)) continue
    const reason = hostDeviceBlocker(type, key, value)
    if (reason) blockers.push({ section, key, reason })
  }

  return { volumes, isos, storages: [...new Set(volumes.map(v => v.storage))], blockers }
}

export type RemapPlan = {
  /** Source storage ID to the target storage ID proven to hold the same volumes. */
  storages: Readonly<Record<string, string>>
  /** Every NIC lands on this bridge, as in a cross-cluster migration with copy. */
  bridge: string
}

function replaceVolume(value: string, storage: string, target: string): string {
  const { index, prefix, volume } = locateVolume(value)
  const tokens = value.split(',')
  tokens[index] = prefix + target + volume.slice(storage.length)

  return tokens.join(',')
}

/**
 * The configuration file as the target cluster must hold it. Throws when a
 * disk sits on a storage without a target: writing the guest without that
 * disk would hand over a guest that cannot boot, or boots without its data.
 */
export function remapGuestConf(raw: string, type: GuestType, plan: RemapPlan): { conf: string; detachedIsos: string[] } {
  const detachedIsos: string[] = []
  const out: string[] = []

  for (const line of readLines(raw)) {
    if (line.kind !== 'entry') {
      out.push(line.text)
      continue
    }
    const { section, key, value } = line

    if (/^net\d+$/.test(key)) {
      out.push(`${key}: ${value.replace(/(^|,)bridge=[^,]*/, `$1bridge=${plan.bridge}`)}`)
      continue
    }

    const disk = isDiskKey(type, key) ? classifyDisk(type, value) : null
    if (!disk || (disk.kind !== 'volume' && disk.kind !== 'iso')) {
      out.push(line.text)
      continue
    }

    const target = plan.storages[disk.storage]
    if (target) {
      out.push(`${key}: ${replaceVolume(value, disk.storage, target)}`)
    } else if (disk.kind === 'iso') {
      if (isCurrentSection(section)) detachedIsos.push(disk.volid)
      out.push(`${key}: none,media=cdrom`)
    } else {
      throw new Error(`No target storage for "${disk.storage}" (${section === MAIN ? key : `${section}/${key}`})`)
    }
  }

  return { conf: out.join('\n'), detachedIsos }
}
