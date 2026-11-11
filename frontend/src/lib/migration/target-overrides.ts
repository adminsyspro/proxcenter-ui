/**
 * Operator overrides applied to the VM a migration creates (#317, lot 1).
 *
 * Two families, both optional and both persisted in `job.config` so a retry
 * rebuilds the same VM:
 * - `hardware`: cores, sockets and memory of the target, when the operator
 *   right-sizes the VM at migration time instead of inheriting the source;
 * - `nics`: one target bridge (physical bridge or SDN VNet), optional VLAN tag
 *   and optional model per source NIC, by position in the source NIC list. A
 *   NIC without a mapping falls back to the dialog's default bridge and tag;
 * - `disks` (lot 2): one target storage per source disk, by position in the
 *   source disk list, or the disk left out of the migration. A disk without a
 *   mapping goes to the job's `targetStorage`, which also holds efidisk0 and
 *   tpmstate0.
 *
 * The route validates everything here before the values reach `qm create`; the
 * mappers only apply what they are given.
 */

import { isKnownCpuType } from "@/lib/inventory/cpuModels"
import { assertStorageName } from "@/lib/ssh/validate"

export interface MigrationNicMapping {
  /** Position of the NIC in the source VM's NIC list (0 = first adapter). */
  index: number
  /** Target bridge or SDN VNet name, as `bridge=` expects it. */
  bridge: string
  /** 802.1Q tag for this NIC, 1 to 4094; absent means the bridge's native VLAN. */
  vlanTag?: number
  /** Proxmox NIC model; absent means the model the mapper derives from the source adapter. */
  model?: string
  /**
   * MAC address of the target NIC (ui#1330): absent keeps the source MAC,
   * "regenerate" lets Proxmox assign one from the datacenter's prefix,
   * "custom" sets `mac`.
   */
  macMode?: Exclude<MigrationMacMode, "keep">
  /** The MAC set when `macMode` is "custom", upper case with colons. */
  mac?: string
}

/** MAC choices of a target NIC (ui#1330). */
export const MIGRATION_MAC_MODES = ["keep", "regenerate", "custom"] as const
export type MigrationMacMode = typeof MIGRATION_MAC_MODES[number]

/**
 * Options of the target disks (ui#1331). On the job, the profile every disk
 * starts from; on one disk mapping, that disk's choice. An option left out
 * takes the default: `discard` on a thin-provisioned storage, `iothread` on a
 * bus that supports it, `ssd` off.
 */
export interface MigrationDiskOptions {
  discard?: boolean
  iothread?: boolean
  ssd?: boolean
}

export const MIGRATION_DISK_OPTION_KEYS = ["discard", "iothread", "ssd"] as const

/**
 * One row of the bulk dialog's network table (ui#1333): every adapter on the
 * source network `source` (a vSphere port group name) lands on `bridge`, with
 * `vlanTag` when set. A NIC whose network has no row falls back to the job's
 * networkBridge and vlanTag.
 */
export interface MigrationNetworkMapEntry {
  source: string
  bridge: string
  vlanTag?: number
}

export interface MigrationHardwareOverrides {
  cores?: number
  sockets?: number
  memoryMB?: number
  /**
   * UEFI targets only (#1000): enrol the standard Microsoft Secure Boot keys in
   * the EFI disk (`pre-enrolled-keys=1`, the Proxmox default). False creates an
   * EFI disk without keys, so Secure Boot is off: what a guest whose shim the
   * current revocation list rejects (CentOS 8) needs to boot. Absent means true.
   */
  efiPreEnrolledKeys?: boolean
}

export interface MigrationDiskMapping {
  /** Position of the disk in the source VM's disk list (0 = first disk, the boot disk). */
  index: number
  /** Target storage of this disk; absent means the job's targetStorage. */
  targetStorage?: string
  /** Leave this disk out of the migration. Never allowed on disk 0, the boot disk. */
  exclude?: boolean
  /**
   * Target bus of this disk (#1000); absent or "auto" keeps the mapper's rule
   * (the source bus, SATA for the boot disk of a Windows or UEFI guest, SCSI
   * once the guest is converted). Applied by the warm VMware engine.
   */
  bus?: MigrationDiskBus
  /** This disk's options (ui#1331), over the job's profile. */
  discard?: boolean
  iothread?: boolean
  ssd?: boolean
}

/** Disk bus choices of the review step: the mapper's rule, or one forced bus. */
export const MIGRATION_DISK_BUSES = ["auto", "scsi", "sata"] as const
export type MigrationDiskBus = typeof MIGRATION_DISK_BUSES[number]

export interface MigrationTargetOverrides {
  nics?: MigrationNicMapping[]
  hardware?: MigrationHardwareOverrides
  disks?: MigrationDiskMapping[]
  /** Source network to target bridge table of a bulk batch (ui#1333). */
  networkMap?: MigrationNetworkMapEntry[]
  /** "regenerate": every NIC without its own MAC choice gets a Proxmox MAC (ui#1330, bulk). */
  macPolicy?: "regenerate"
}

/** Proxmox NIC models the review step offers. */
export const MIGRATION_NIC_MODELS = ["virtio", "e1000", "e1000e", "vmxnet3", "rtl8139"] as const

/** `qemu-server` limits: cores 1-128, sockets 1-4, memory 16 MiB minimum. */
export const HARDWARE_LIMITS = {
  cores: { min: 1, max: 128 },
  sockets: { min: 1, max: 4 },
  memoryMB: { min: 16, max: 4194304 },
} as const

/** Proxmox supports net0 to net31. */
export const MAX_NICS = 32

/** Upper bound of the disk list (Proxmox has 56 disk slots: scsi0-30, virtio0-15, sata0-5, ide0-3). */
export const MAX_DISKS = 64

/**
 * The ui#1330/#1331/#1333 options of a persisted job config, for the engine
 * configs rebuilt from it (start, retry, batch). The create route validated
 * them before they were stored.
 */
export function jobTargetOptions(c: Record<string, any>): { networkMap?: MigrationNetworkMapEntry[]; macPolicy?: "regenerate"; diskOptions?: MigrationDiskOptions } {
  return {
    ...(Array.isArray(c.networkMap) && c.networkMap.length > 0 && { networkMap: c.networkMap }),
    ...(c.macPolicy === "regenerate" && { macPolicy: "regenerate" as const }),
    ...(c.diskOptions && typeof c.diskOptions === "object" && !Array.isArray(c.diskOptions) && { diskOptions: c.diskOptions }),
  }
}

/** Most rows the bulk network table can hold. */
export const MAX_NETWORK_MAP_ENTRIES = 256

/** PVE bridge ids (`vmbr0`), OVS bridges and SDN VNet ids (lowercase, 8 chars). */
const BRIDGE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/

type ParseResult<T> = { ok: true; value: T | undefined } | { ok: false; error: string }

function intInRange(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === "number" ? raw : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

/**
 * Validate the `hardware` field of a POST /api/v1/migrations body. Absent or
 * empty means "inherit the source" and resolves to undefined; any field present
 * must be an integer inside the Proxmox limits.
 */
export function parseHardwareOverrides(raw: unknown): ParseResult<MigrationHardwareOverrides> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "hardware must be an object" }
  const src = raw as Record<string, unknown>
  const out: MigrationHardwareOverrides = {}
  for (const key of ["cores", "sockets", "memoryMB"] as const) {
    const v = src[key]
    if (v === undefined || v === null || v === "") continue
    const { min, max } = HARDWARE_LIMITS[key]
    const n = intInRange(v, min, max)
    if (n === null) return { ok: false, error: `hardware.${key} must be an integer between ${min} and ${max}` }
    out[key] = n
  }
  const keys = src.efiPreEnrolledKeys
  if (keys !== undefined && keys !== null) {
    if (typeof keys !== "boolean") return { ok: false, error: "hardware.efiPreEnrolledKeys must be a boolean" }
    // Only the departure from the default is kept, like the other fields.
    if (!keys) out.efiPreEnrolledKeys = false
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : undefined }
}

/**
 * Validate the `nics` field of a POST /api/v1/migrations body: an array of
 * `{ index, bridge, vlanTag?, model? }`, unique indexes, well-formed names.
 * An empty array resolves to undefined (every NIC on the default bridge).
 */
export function parseNicMappings(raw: unknown): ParseResult<MigrationNicMapping[]> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (!Array.isArray(raw)) return { ok: false, error: "nics must be an array" }
  if (raw.length > MAX_NICS) return { ok: false, error: `nics cannot hold more than ${MAX_NICS} entries` }
  const seen = new Set<number>()
  const out: MigrationNicMapping[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "nics entries must be objects" }
    const e = entry as Record<string, unknown>
    const index = intInRange(e.index, 0, MAX_NICS - 1)
    if (index === null) return { ok: false, error: `nics[].index must be an integer between 0 and ${MAX_NICS - 1}` }
    if (seen.has(index)) return { ok: false, error: `nics[].index ${index} is listed twice` }
    seen.add(index)
    const bridge = typeof e.bridge === "string" ? e.bridge.trim() : ""
    if (!BRIDGE_RE.test(bridge)) return { ok: false, error: `nics[${index}].bridge must be a bridge or VNet name` }
    const nic: MigrationNicMapping = { index, bridge }
    if (e.vlanTag !== undefined && e.vlanTag !== null && e.vlanTag !== "") {
      const tag = intInRange(e.vlanTag, 1, 4094)
      if (tag === null) return { ok: false, error: `nics[${index}].vlanTag must be an integer between 1 and 4094` }
      nic.vlanTag = tag
    }
    if (e.model !== undefined && e.model !== null && e.model !== "") {
      if (typeof e.model !== "string" || !(MIGRATION_NIC_MODELS as readonly string[]).includes(e.model)) {
        return { ok: false, error: `nics[${index}].model must be one of ${MIGRATION_NIC_MODELS.join(", ")}` }
      }
      nic.model = e.model
    }
    const mac = parseNicMac(index, e.macMode, e.mac)
    if (typeof mac === "string") return { ok: false, error: mac }
    Object.assign(nic, mac)
    out.push(nic)
  }
  out.sort((a, b) => a.index - b.index)
  return { ok: true, value: out.length > 0 ? out : undefined }
}

/** A unicast MAC Proxmox accepts: six hex pairs, multicast bit clear, not all zero. */
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/

/** The MAC normalised to upper case with colons, or null when it is not a usable unicast address. */
export function normalizeUnicastMac(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const mac = raw.trim().toUpperCase().replace(/-/g, ":")
  if (!MAC_RE.test(mac)) return null
  if ((Number.parseInt(mac.slice(0, 2), 16) & 1) === 1) return null
  if (mac === "00:00:00:00:00:00") return null
  return mac
}

/** The MAC fields of one NIC mapping, or the error message. */
function parseNicMac(index: number, rawMode: unknown, rawMac: unknown): Pick<MigrationNicMapping, "macMode" | "mac"> | string {
  if (rawMode === undefined || rawMode === null || rawMode === "" || rawMode === "keep") {
    return rawMac === undefined || rawMac === null || rawMac === "" ? {} : `nics[${index}].mac needs macMode "custom"`
  }
  if (rawMode === "regenerate") return { macMode: "regenerate" }
  if (rawMode !== "custom") return `nics[${index}].macMode must be one of ${MIGRATION_MAC_MODES.join(", ")}`
  const mac = normalizeUnicastMac(rawMac)
  if (!mac) return `nics[${index}].mac must be a unicast MAC address such as BC:24:11:12:34:56`
  return { macMode: "custom", mac }
}

/** The custom MACs of a NIC list, in NIC order. */
export function customMacs(nics: MigrationNicMapping[] | undefined): string[] {
  return (nics ?? []).flatMap(n => (n.macMode === "custom" && n.mac ? [n.mac] : []))
}

/**
 * Validate the job-level `macPolicy` (ui#1330, bulk dialog): absent or "keep"
 * keeps the source MACs, "regenerate" lets Proxmox assign every NIC a MAC.
 */
export function parseMacPolicy(raw: unknown): ParseResult<"regenerate"> {
  if (raw === undefined || raw === null || raw === "" || raw === "keep") return { ok: true, value: undefined }
  if (raw === "regenerate") return { ok: true, value: "regenerate" }
  return { ok: false, error: `macPolicy must be "keep" or "regenerate"` }
}

/** The disk option booleans of `src`, or the name of the first one that is not a boolean. */
function pickDiskOptions(src: Record<string, unknown>): MigrationDiskOptions | string {
  const out: MigrationDiskOptions = {}
  for (const key of MIGRATION_DISK_OPTION_KEYS) {
    const v = src[key]
    if (v === undefined || v === null) continue
    if (typeof v !== "boolean") return key
    out[key] = v
  }
  return out
}

/**
 * Validate the job-level `diskOptions` profile (ui#1331): booleans for
 * discard, iothread and ssd. Absent, or every option left out, resolves to
 * undefined: the defaults apply.
 */
export function parseDiskOptions(raw: unknown): ParseResult<MigrationDiskOptions> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "diskOptions must be an object" }
  const picked = pickDiskOptions(raw as Record<string, unknown>)
  if (typeof picked === "string") return { ok: false, error: `diskOptions.${picked} must be a boolean` }
  return { ok: true, value: Object.keys(picked).length > 0 ? picked : undefined }
}

/**
 * Validate the bulk `networkMap` (ui#1333): rows of `{ source, bridge,
 * vlanTag? }`, one row per source network. An empty table resolves to
 * undefined (every NIC on the default bridge).
 */
export function parseNetworkMap(raw: unknown): ParseResult<MigrationNetworkMapEntry[]> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (!Array.isArray(raw)) return { ok: false, error: "networkMap must be an array" }
  if (raw.length > MAX_NETWORK_MAP_ENTRIES) return { ok: false, error: `networkMap cannot hold more than ${MAX_NETWORK_MAP_ENTRIES} entries` }
  const seen = new Set<string>()
  const out: MigrationNetworkMapEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "networkMap entries must be objects" }
    const e = entry as Record<string, unknown>
    const source = typeof e.source === "string" ? e.source.trim() : ""
    if (source === "" || source.length > 256) return { ok: false, error: "networkMap[].source must be a network name of 1 to 256 characters" }
    if (seen.has(source)) return { ok: false, error: `networkMap lists ${JSON.stringify(source)} twice` }
    seen.add(source)
    const bridge = typeof e.bridge === "string" ? e.bridge.trim() : ""
    if (!BRIDGE_RE.test(bridge)) return { ok: false, error: `networkMap bridge for ${JSON.stringify(source)} must be a bridge or VNet name` }
    const row: MigrationNetworkMapEntry = { source, bridge }
    if (e.vlanTag !== undefined && e.vlanTag !== null && e.vlanTag !== "") {
      const tag = intInRange(e.vlanTag, 1, 4094)
      if (tag === null) return { ok: false, error: `networkMap VLAN tag for ${JSON.stringify(source)} must be an integer between 1 and 4094` }
      row.vlanTag = tag
    }
    out.push(row)
  }
  return { ok: true, value: out.length > 0 ? out : undefined }
}

/**
 * Validate the `disks` field of a POST /api/v1/migrations body: an array of
 * `{ index, targetStorage?, exclude? }`, unique indexes, storage ids in the
 * PVE grammar (the name reaches `pvesm alloc` and `qm disk import` on the
 * node). The boot disk cannot be excluded. An entry that changes nothing is
 * dropped; an empty array resolves to undefined (every disk on targetStorage).
 */
export function parseDiskMappings(raw: unknown): ParseResult<MigrationDiskMapping[]> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (!Array.isArray(raw)) return { ok: false, error: "disks must be an array" }
  if (raw.length > MAX_DISKS) return { ok: false, error: `disks cannot hold more than ${MAX_DISKS} entries` }
  const seen = new Set<number>()
  const out: MigrationDiskMapping[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "disks entries must be objects" }
    const e = entry as Record<string, unknown>
    const index = intInRange(e.index, 0, MAX_DISKS - 1)
    if (index === null) return { ok: false, error: `disks[].index must be an integer between 0 and ${MAX_DISKS - 1}` }
    if (seen.has(index)) return { ok: false, error: `disks[].index ${index} is listed twice` }
    seen.add(index)
    if (e.exclude !== undefined && e.exclude !== null && typeof e.exclude !== "boolean") {
      return { ok: false, error: `disks[${index}].exclude must be a boolean` }
    }
    if (e.exclude === true) {
      if (index === 0) return { ok: false, error: "disks[0] is the boot disk and cannot be excluded" }
      out.push({ index, exclude: true })
      continue
    }
    const disk: MigrationDiskMapping = { index }
    if (e.targetStorage !== undefined && e.targetStorage !== null && e.targetStorage !== "") {
      try {
        assertStorageName(e.targetStorage)
      } catch {
        return { ok: false, error: `disks[${index}].targetStorage must be a storage name` }
      }
      disk.targetStorage = e.targetStorage as string
    }
    if (e.bus !== undefined && e.bus !== null && e.bus !== "") {
      if (typeof e.bus !== "string" || !(MIGRATION_DISK_BUSES as readonly string[]).includes(e.bus)) {
        return { ok: false, error: `disks[${index}].bus must be one of ${MIGRATION_DISK_BUSES.join(", ")}` }
      }
      if (e.bus !== "auto") disk.bus = e.bus as MigrationDiskBus
    }
    const options = pickDiskOptions(e)
    if (typeof options === "string") return { ok: false, error: `disks[${index}].${options} must be a boolean` }
    Object.assign(disk, options)
    if (Object.keys(disk).length > 1) out.push(disk)
  }
  out.sort((a, b) => a.index - b.index)
  return { ok: true, value: out.length > 0 ? out : undefined }
}

/** One source disk the migration copies, with its position in the source list and its target storage. */
export interface PlannedDisk<T> {
  disk: T
  sourceIndex: number
  storage: string
  /** The operator's forced bus (#1000); absent means the mapper's rule. */
  bus?: Exclude<MigrationDiskBus, "auto">
  /** The operator's options for this disk (ui#1331), over the job's profile. */
  options?: MigrationDiskOptions
}

export interface DiskPlan<T> {
  /** The disks to copy, in source order. */
  kept: PlannedDisk<T>[]
  /** Source positions the operator left out. */
  excluded: number[]
  /** Mapped positions the source VM does not have (the VM changed since the dialog read it). */
  unknown: number[]
}

/**
 * Resolve the per-disk choices against the disks the pipeline actually read
 * from the source. Every pipeline calls this right after reading the source
 * config and then works on `kept` only, so an excluded disk is never
 * allocated, copied or attached, and disk i of the filtered list lands on
 * `kept[i].storage`.
 */
export function planDiskTargets<T>(
  disks: readonly T[],
  mappings: MigrationDiskMapping[] | undefined,
  defaultStorage: string,
): DiskPlan<T> {
  const byIndex = new Map((mappings ?? []).map(m => [m.index, m]))
  const kept: PlannedDisk<T>[] = []
  const excluded: number[] = []
  disks.forEach((disk, sourceIndex) => {
    const m = byIndex.get(sourceIndex)
    if (m?.exclude && sourceIndex !== 0) {
      excluded.push(sourceIndex)
      return
    }
    const options = m ? diskOptionsOf(m) : undefined
    kept.push({ disk, sourceIndex, storage: m?.targetStorage || defaultStorage, ...(m?.bus && m.bus !== "auto" && { bus: m.bus }), ...(options && { options }) })
  })
  const unknown = [...byIndex.keys()].filter(i => i >= disks.length).sort((a, b) => a - b)
  return { kept, excluded, unknown }
}

/** The options a disk mapping sets, or undefined when it sets none. */
export function diskOptionsOf(m: MigrationDiskOptions): MigrationDiskOptions | undefined {
  const out: MigrationDiskOptions = {}
  for (const key of MIGRATION_DISK_OPTION_KEYS) if (typeof m[key] === "boolean") out[key] = m[key]
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Storage types where a disk is thin-provisioned, so `discard=on` returns the
 * blocks the guest frees to the pool: Ceph RBD, ZFS, LVM-thin, and the file
 * storages (a sparse raw or qcow2 file). Thick LVM, iSCSI and ZFS over iSCSI
 * gain nothing from it by default.
 */
const THIN_STORAGE_TYPES: ReadonlySet<string> = new Set(["rbd", "zfspool", "lvmthin", "dir", "nfs", "cifs", "glusterfs", "cephfs", "btrfs"])

export function isThinStorageType(type: string | null | undefined): boolean {
  return !!type && THIN_STORAGE_TYPES.has(type)
}

export interface DriveOptionsInput {
  /** The target slot (`scsi0`, `sata1`, `virtio0`, `ide0`). */
  slot: string
  /** PVE type of the disk's storage; unknown means not thin. */
  storageType?: string | null
  /** The VM's SCSI controller: iothread on a SCSI disk needs `virtio-scsi-single`. */
  scsihw?: string | null
  /** The job's profile (ui#1331). */
  profile?: MigrationDiskOptions
  /** This disk's own choice, over the profile. */
  disk?: MigrationDiskOptions
}

/**
 * Drive options appended to a disk's volume id when it is attached (ui#1331),
 * e.g. `,discard=on,iothread=1`. `discard` defaults to on for a thin storage,
 * `iothread` to on wherever the bus supports it (a VirtIO Block disk, or a
 * SCSI disk on `virtio-scsi-single`, the controller every migration creates),
 * `ssd` to off; it never reaches a VirtIO Block disk, which has no such flag.
 */
export function diskDriveOptions({ slot, storageType, scsihw, profile, disk }: DriveOptionsInput): string {
  const bus = /^[a-z]+/.exec(slot)?.[0] ?? ""
  const pick = (key: keyof MigrationDiskOptions, fallback: boolean) => disk?.[key] ?? profile?.[key] ?? fallback
  const iothreadCapable = bus === "virtio" || (bus === "scsi" && scsihw === "virtio-scsi-single")
  let out = ""
  if (pick("discard", isThinStorageType(storageType))) out += ",discard=on"
  if (iothreadCapable && pick("iothread", true)) out += ",iothread=1"
  if (bus !== "virtio" && bus !== "" && pick("ssd", false)) out += ",ssd=1"
  return out
}

/** The distinct target storages of a plan, in first-use order. */
export function planStorages(plan: DiskPlan<unknown>): string[] {
  return [...new Set(plan.kept.map(k => k.storage))]
}

/** Bytes each target storage receives, summed over the kept disks. */
export function bytesPerStorage<T>(plan: DiskPlan<T>, sizeOf: (disk: T) => number): Map<string, number> {
  const out = new Map<string, number>()
  for (const k of plan.kept) out.set(k.storage, (out.get(k.storage) ?? 0) + sizeOf(k.disk))
  return out
}

/**
 * One line for the job log when the plan differs from "every disk on
 * targetStorage", or null. Disks are numbered from 1, like the rest of the log.
 */
export function describeDiskPlan(plan: DiskPlan<unknown>, defaultStorage: string): string | null {
  const parts: string[] = []
  if (plan.kept.some(k => k.storage !== defaultStorage)) {
    parts.push(`storage ${plan.kept.map(k => `disk ${k.sourceIndex + 1}->${k.storage}`).join(", ")}`)
  }
  const forced = plan.kept.filter(k => k.bus)
  if (forced.length > 0) parts.push(`bus ${forced.map(k => `disk ${k.sourceIndex + 1}->${k.bus!.toUpperCase()}`).join(", ")}`)
  const withOptions = plan.kept.filter(k => k.options)
  if (withOptions.length > 0) parts.push(`options ${withOptions.map(k => `disk ${k.sourceIndex + 1}->${describeDiskOptions(k.options!)}`).join(", ")}`)
  if (plan.excluded.length > 0) parts.push(`excluded ${plan.excluded.map(i => `disk ${i + 1}`).join(", ")}`)
  if (plan.unknown.length > 0) parts.push(`ignored mapping for missing ${plan.unknown.map(i => `disk ${i + 1}`).join(", ")}`)
  return parts.length > 0 ? `Per-disk choices: ${parts.join("; ")}` : null
}

/** `discard on, ssd off`: the options a profile or a disk sets, for the job log. */
export function describeDiskOptions(o: MigrationDiskOptions): string {
  return MIGRATION_DISK_OPTION_KEYS.filter(k => typeof o[k] === "boolean").map(k => `${k} ${o[k] ? "on" : "off"}`).join(" ")
}

/** The storage id of a PVE volume id (`CephPool:vm-101-disk-0`), or the fallback when it has none. */
export function storageOfVolume(volumeId: string, fallback: string): string {
  const i = volumeId.indexOf(":")
  return i > 0 ? volumeId.slice(0, i) : fallback
}

/**
 * CPU model accepted for `qm create --cpu`: a QEMU model Proxmox knows, or a
 * cluster-defined `custom-<name>` model. Anything else never reaches the node.
 */
export function isAcceptableCpuType(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false
  return isKnownCpuType(value) || /^custom-[A-Za-z0-9_.-]+$/.test(value)
}

/**
 * The target of one NIC: the operator's mapping of that NIC (review step),
 * else the bulk table's row for its source network (ui#1333), else the
 * dialog defaults.
 */
export function resolveNicTarget(
  index: number,
  nics: MigrationNicMapping[] | undefined,
  defaults: { bridge: string; vlanTag?: number },
  network?: { name?: string; map?: MigrationNetworkMapEntry[] },
): { bridge: string; vlanTag?: number; model?: string; macMode?: MigrationNicMapping["macMode"]; mac?: string } {
  const m = nics?.find(n => n.index === index)
  if (m) return { bridge: m.bridge, vlanTag: m.vlanTag ?? defaults.vlanTag, model: m.model, macMode: m.macMode, mac: m.mac }
  const row = network?.name ? network.map?.find(r => r.source === network.name) : undefined
  if (row) return { bridge: row.bridge, vlanTag: row.vlanTag ?? defaults.vlanTag }
  return { bridge: defaults.bridge, vlanTag: defaults.vlanTag }
}

/**
 * The MAC the target NIC gets (ui#1330): the operator's custom MAC, nothing
 * (Proxmox assigns one) when the NIC or the whole job regenerates, the
 * source MAC otherwise.
 */
export function targetNicMac(
  sourceMac: string | undefined,
  target: { macMode?: MigrationNicMapping["macMode"]; mac?: string },
  macPolicy?: "regenerate",
): string | undefined {
  if (target.macMode === "custom") return target.mac
  if (target.macMode === "regenerate" || macPolicy === "regenerate") return undefined
  return sourceMac
}

/** `tag=N` suffix for a valid 802.1Q tag, empty otherwise. */
export function vlanTagSuffix(vlanTag: number | undefined): string {
  return typeof vlanTag === "number" && Number.isInteger(vlanTag) && vlanTag >= 1 && vlanTag <= 4094 ? `,tag=${vlanTag}` : ""
}

/** `macaddr=` suffix when the source MAC is a well-formed unicast address. */
export function macSuffix(mac: string | undefined): string {
  return mac && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(mac) ? `,macaddr=${mac}` : ""
}

/** `virtio,bridge=vmbr0,macaddr=..,tag=..`: the value of one `netN` key. */
export function buildNetValue(model: string, bridge: string, mac?: string, vlanTag?: number): string {
  return `${model},bridge=${bridge}${macSuffix(mac)}${vlanTagSuffix(vlanTag)}`
}

/** Apply the hardware overrides on top of the values derived from the source. */
export function applyHardwareOverrides<T extends { cores: number; sockets: number; memory: number }>(
  params: T,
  hardware: MigrationHardwareOverrides | undefined,
): T {
  if (!hardware) return params
  if (hardware.cores !== undefined) params.cores = hardware.cores
  if (hardware.sockets !== undefined) params.sockets = hardware.sockets
  if (hardware.memoryMB !== undefined) params.memory = hardware.memoryMB
  return params
}

function describeNicMac(n: MigrationNicMapping): string {
  if (n.macMode === "custom") return ` MAC ${n.mac}`
  return n.macMode === "regenerate" ? " new MAC" : ""
}

/** One line for the job log describing what the operator changed, or null when nothing was. */
export function describeOverrides(overrides: MigrationTargetOverrides | undefined): string | null {
  if (!overrides) return null
  const parts: string[] = []
  const hw = overrides.hardware
  if (hw) {
    const hwParts: string[] = []
    if (hw.cores !== undefined) hwParts.push(`cores=${hw.cores}`)
    if (hw.sockets !== undefined) hwParts.push(`sockets=${hw.sockets}`)
    if (hw.memoryMB !== undefined) hwParts.push(`memory=${hw.memoryMB}MB`)
    if (hw.efiPreEnrolledKeys === false) hwParts.push("EFI disk without pre-enrolled Secure Boot keys")
    if (hwParts.length > 0) parts.push(`hardware ${hwParts.join(", ")}`)
  }
  if (overrides.nics && overrides.nics.length > 0) {
    parts.push(`NICs ${overrides.nics.map(n => `net${n.index}->${n.bridge}${n.vlanTag ? ` tag ${n.vlanTag}` : ""}${n.model ? ` (${n.model})` : ""}${describeNicMac(n)}`).join(", ")}`)
  }
  if (overrides.networkMap && overrides.networkMap.length > 0) {
    parts.push(`networks ${overrides.networkMap.map(r => `${JSON.stringify(r.source)}->${r.bridge}${r.vlanTag ? ` tag ${r.vlanTag}` : ""}`).join(", ")}`)
  }
  if (overrides.macPolicy === "regenerate") parts.push("MAC addresses regenerated by Proxmox")
  return parts.length > 0 ? `Operator overrides: ${parts.join("; ")}` : null
}
