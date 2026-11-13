// Pure planning of a move between two vDCs of one tenant (#1335): what the
// guest carries (volumes per source storage, NICs per source bridge), what
// blocks a cross-cluster copy, and the mapping strings PVE's remote_migrate
// takes. PVE maps per SOURCE storage and per SOURCE bridge
// (`target-storage` / `target-bridge` are "source:target" lists), so the move
// is planned at that grain, never per disk or per NIC.

import {
  AUX_DISK_KEY_RE,
  DATA_DISK_KEY_RE,
  QOS_KEYS,
  parseDriveString,
  parsePveSizeToMb,
  stampDriveQos,
  type DriveQosCaps,
} from '@/lib/vdc/drives'

export type MoveIssueCode =
  | 'CLOUD_INIT_DRIVE'
  | 'CDROM_INSERTED'
  | 'PASSTHROUGH_DEVICE'
  | 'UNSUPPORTED_DISK'
  | 'STORAGE_NOT_MAPPED'
  | 'STORAGE_NOT_IN_TARGET_VDC'
  | 'NETWORK_NOT_MAPPED'
  | 'NETWORK_NOT_IN_TARGET_VDC'
  | 'VLAN_TAG_ON_VNET'
  | 'VLAN_TAG_NOT_ALLOWED'

export interface MoveIssue {
  code: MoveIssueCode
  context: Record<string, string | number>
}

export interface SourceStorageGroup {
  storage: string
  /** Config keys of the volumes held on this storage, in config order. */
  disks: string[]
  /** Sum of the size= options, 0 for a volume that declares none (unusedN). */
  sizeMb: number
}

export interface SourceBridgeGroup {
  bridge: string
  nics: string[]
  /** VLAN tags the NICs of the group carry (a trunk counts as untaggable: see inspect). */
  tags: number[]
}

export interface InspectedGuest {
  storages: SourceStorageGroup[]
  bridges: SourceBridgeGroup[]
  totalDiskMb: number
  vcpus: number
  memoryMb: number
  cpuModel: string | null
  blockers: MoveIssue[]
}

const NET_KEY_RE = /^net\d+$/
const HOSTPCI_KEY_RE = /^hostpci\d+$/
const USB_KEY_RE = /^usb\d+$/

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function optionValue(raw: string, key: string): string | undefined {
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=')
    if (idx > 0 && part.slice(0, idx).trim() === key) return part.slice(idx + 1).trim()
  }
  return undefined
}

/** `cpu: [cputype=]<model>[,flags=...]` -> the model; null when unset (PVE default). */
function cpuModelOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const first = value.split(',')[0].trim()

  return first.startsWith('cputype=') ? first.slice('cputype='.length) : first
}

function inspectVolume(key: string, raw: string, groups: Map<string, SourceStorageGroup>, blockers: MoveIssue[]): void {
  if (raw.trim().startsWith('/')) {
    blockers.push({ code: 'PASSTHROUGH_DEVICE', context: { key } })
    return
  }
  const parsed = parseDriveString(raw)
  if (parsed.ok === false) {
    blockers.push({ code: 'UNSUPPORTED_DISK', context: { key } })
    return
  }
  const { drive } = parsed
  if (drive.storage === null) return // empty CD/DVD drive
  if (/cloudinit/.test(drive.head)) {
    blockers.push({ code: 'CLOUD_INIT_DRIVE', context: { key } })
    return
  }
  if (drive.isCdrom) {
    blockers.push({ code: 'CDROM_INSERTED', context: { key } })
    return
  }
  const size = drive.opts.find(([k]) => k === 'size')?.[1]
  const sizeMb = size ? parsePveSizeToMb(size) : 0
  const group = groups.get(drive.storage) ?? { storage: drive.storage, disks: [], sizeMb: 0 }
  group.disks.push(key)
  group.sizeMb += sizeMb
  groups.set(drive.storage, group)
}

/** Read a QEMU guest config: what has to move, and what forbids moving it. */
export function inspectGuestConfig(config: Record<string, unknown>): InspectedGuest {
  const storages = new Map<string, SourceStorageGroup>()
  const bridges = new Map<string, SourceBridgeGroup>()
  const blockers: MoveIssue[] = []

  for (const [key, value] of Object.entries(config ?? {})) {
    const raw = String(value ?? '')
    if (DATA_DISK_KEY_RE.test(key) || AUX_DISK_KEY_RE.test(key)) {
      inspectVolume(key, raw, storages, blockers)
    } else if (NET_KEY_RE.test(key)) {
      const bridge = optionValue(raw, 'bridge')
      if (!bridge) continue
      const group = bridges.get(bridge) ?? { bridge, nics: [], tags: [] }
      group.nics.push(key)
      const tag = Number(optionValue(raw, 'tag'))
      if (Number.isInteger(tag) && tag > 0 && !group.tags.includes(tag)) group.tags.push(tag)
      // A trunk cannot be judged against VLAN pools: it is carried as tag 0,
      // which no pool covers, so the move is refused on any target bridge.
      if (optionValue(raw, 'trunks') !== undefined && !group.tags.includes(0)) group.tags.push(0)
      bridges.set(bridge, group)
    } else if (HOSTPCI_KEY_RE.test(key) || (USB_KEY_RE.test(key) && /(^|,)host=/.test(raw))) {
      blockers.push({ code: 'PASSTHROUGH_DEVICE', context: { key } })
    }
  }

  const storageList = [...storages.values()]
  const sockets = toPositiveInt(config?.sockets, 1)
  const cores = toPositiveInt(config?.cores, 1)

  return {
    storages: storageList,
    bridges: [...bridges.values()],
    totalDiskMb: storageList.reduce((sum, g) => sum + g.sizeMb, 0),
    vcpus: config?.vcpus !== undefined ? toPositiveInt(config.vcpus, sockets * cores) : sockets * cores,
    memoryMb: toPositiveInt(config?.memory, 512),
    cpuModel: cpuModelOf(config?.cpu),
    blockers,
  }
}

export interface MoveMapping {
  storageMap: Record<string, string>
  bridgeMap: Record<string, string>
}

export interface TargetAllowance {
  /** Storages of the target vDC a guest disk may be written to. */
  allowedStorages: Set<string>
  /** VNets and shared bridges of the target vDC. */
  allowedBridges: Set<string>
  /** The subset of allowedBridges that are tenant VNets (no VLAN tag allowed on them). */
  vnetBridges?: Set<string>
  /** VLAN pools of the target vDC: bridge -> [start, end] ranges. */
  vlanRanges?: Map<string, Array<[number, number]>>
}

function tagAllowed(ranges: Array<[number, number]> | undefined, tag: number): boolean {
  return (ranges ?? []).some(([start, end]) => tag >= start && tag <= end)
}

/** Every source storage and bridge must land on one the target vDC grants. */
export function validateMoveMapping(guest: InspectedGuest, mapping: MoveMapping, target: TargetAllowance): MoveIssue[] {
  const issues: MoveIssue[] = []
  const bridgeIssues: MoveIssue[] = []

  for (const group of guest.storages) {
    const dest = mapping.storageMap[group.storage]
    if (!dest) issues.push({ code: 'STORAGE_NOT_MAPPED', context: { storage: group.storage } })
    else if (!target.allowedStorages.has(dest)) issues.push({ code: 'STORAGE_NOT_IN_TARGET_VDC', context: { storage: dest } })
  }

  for (const group of guest.bridges) {
    const dest = mapping.bridgeMap[group.bridge]
    if (!dest) issues.push({ code: 'NETWORK_NOT_MAPPED', context: { bridge: group.bridge } })
    else if (!target.allowedBridges.has(dest)) issues.push({ code: 'NETWORK_NOT_IN_TARGET_VDC', context: { bridge: dest } })
    else if (group.tags.length > 0 && target.vnetBridges?.has(dest)) bridgeIssues.push({ code: 'VLAN_TAG_ON_VNET', context: { bridge: dest } })
    else {
      const refused = group.tags.find((tag) => !tagAllowed(target.vlanRanges?.get(dest), tag))
      if (refused !== undefined) bridgeIssues.push({ code: 'VLAN_TAG_NOT_ALLOWED', context: { bridge: dest, tag: refused } })
    }
  }

  return [...issues, ...bridgeIssues]
}

const PVE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** "src:dst,src2:dst2", sorted so the same plan always yields the same string. */
export function buildPveMapping(map: Record<string, string>): string {
  return Object.keys(map).sort((a, b) => a.localeCompare(b)).map((source) => {
    const target = map[source]
    if (!PVE_ID_RE.test(source) || !PVE_ID_RE.test(target)) throw new Error(`Invalid storage or bridge id in mapping: ${source}`)

    return `${source}:${target}`
  }).join(',')
}

/**
 * The drive line a moved disk should carry on the target. PVE keeps the old
 * options across a migration, so the source tier's caps would follow the
 * disk: replace them with the target tier's, or drop them when the target
 * storage has no policy. Caps on a disk that never sat on a policied storage
 * were set by hand and stay.
 */
export function restampDriveForTarget(raw: string, targetCaps: DriveQosCaps | undefined, sourceWasPolicied: boolean): string {
  if (targetCaps) return stampDriveQos(raw, targetCaps)
  if (!sourceWasPolicied) return raw
  const parsed = parseDriveString(raw)
  if (parsed.ok === false || parsed.drive.storage === null) return raw

  return [parsed.drive.head, ...parsed.drive.opts.filter(([k]) => !QOS_KEYS.has(k)).map(([k, v]) => `${k}=${v}`)].join(',')
}

export interface ClusterNodeResource {
  node: string
  status?: string
  maxmem?: number
  mem?: number
}

/**
 * Target node of a move: an online node the target vDC authorises (an empty
 * list authorises the whole cluster) with room for the guest's RAM, the one
 * with the most free memory first. One /cluster/resources read, no per-node
 * status calls.
 */
export function pickTargetNode(nodes: ClusterNodeResource[], authorised: Set<string>, memoryMb: number): string | null {
  const needed = memoryMb * 1024 * 1024
  const candidates = nodes
    .filter((n) => n.status === 'online' && (authorised.size === 0 || authorised.has(n.node)))
    .map((n) => ({ node: n.node, free: (Number(n.maxmem) || 0) - (Number(n.mem) || 0) }))
    .filter((n) => n.free >= needed)
    .sort((a, b) => b.free - a.free || a.node.localeCompare(b.node))

  return candidates[0]?.node ?? null
}

/**
 * A live copy restarts the guest on the target with the machine version it
 * runs now: a target QEMU that does not know that version refuses it, after
 * PVE allocated the disks (seen in the lab: pc-i440fx-11.1 onto QEMU 11.0.3).
 * `running` is the source's `running-machine`, `machines` the target node's
 * /capabilities/qemu/machines. Unknown on either side does not block.
 */
export function targetRunsMachine(running: string | undefined | null, machines: Array<{ id?: string }> | null | undefined): boolean {
  if (!running || !Array.isArray(machines) || machines.length === 0) return true
  const base = running.split('+')[0]

  return machines.some((m) => typeof m?.id === 'string' && (m.id === base || m.id.startsWith(`${base}+`)))
}

function guestShape(g: InspectedGuest): string {
  const byName = (a: string, b: string) => a.localeCompare(b)

  return JSON.stringify({
    storages: g.storages
      .map((s) => ({ storage: s.storage, disks: [...s.disks].sort(byName), sizeMb: s.sizeMb }))
      .sort((a, b) => byName(a.storage, b.storage)),
    bridges: g.bridges
      .map((b) => ({ bridge: b.bridge, nics: [...b.nics].sort(byName), tags: [...b.tags].sort((x, y) => x - y) }))
      .sort((a, b) => byName(a.bridge, b.bridge)),
    totalDiskMb: g.totalDiskMb,
    vcpus: g.vcpus,
    memoryMb: g.memoryMb,
    cpuModel: g.cpuModel,
    blockers: g.blockers.map((b) => b.code).sort(byName),
  })
}

/**
 * The guest still has the disks, NICs, VLAN tags, size and CPU the move was
 * checked against. PVE keeps the same name on the target for any storage or
 * bridge missing from `target-storage` / `target-bridge`, so a disk or NIC
 * added after the checks would land outside the target vDC.
 */
export function sameGuestShape(checked: InspectedGuest, current: InspectedGuest): boolean {
  return guestShape(checked) === guestShape(current)
}
