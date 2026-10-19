/**
 * State and payload helpers of the migration review step (#317, lots 1 and 2).
 *
 * The review step shows the hardware, the disks and the NICs read from the
 * source VM and lets the operator change the target values. Everything the
 * step edits is kept as strings (what the inputs hold); these helpers build
 * the initial state from the source VM, validate it, and turn it into the
 * `hardware`, `disks` and `nics` fields of POST /api/v1/migrations. Pure, so
 * the node test project covers them without rendering.
 */

import { HARDWARE_LIMITS, type MigrationDiskBus, type MigrationDiskMapping, type MigrationHardwareOverrides, type MigrationNicMapping } from '@/lib/migration/target-overrides'
import { isFileBasedStorage } from '@/lib/proxmox/storage'

export interface ReviewSourceNic {
  label: string
  type: string
  macAddress: string
  network: string
}

/** One source disk, in the order the pipelines index them (parseVmConfig). */
export interface ReviewSourceDisk {
  label: string
  capacityBytes: number
  /** "[Datastore] folder/disk.vmdk" as vSphere reports it. */
  fileName: string
}

/** What the review step needs from GET /api/v1/vmware/[id]/vms/[vmid]. */
export interface ReviewSource {
  numCPU: number
  numCoresPerSocket: number
  sockets: number
  memoryMB: number
  nics: ReviewSourceNic[]
  disks: ReviewSourceDisk[]
  /** The source carries a virtual TPM; its state is never copied (roadmap#1). */
  hasVtpm?: boolean
  /** "efi" or "bios", as vSphere reports it (#1000: Secure Boot keys, boot bus). */
  firmware?: string
  /** vSphere's guest OS name ("Microsoft Windows Server 2022 (64-bit)"). */
  guestOS?: string
  /** An EL10 guest (RHEL 10 family), built for x86-64-v3 (#1000). */
  el10?: boolean
}

/** One row of the disk table: its target storage, and whether the operator left it out. */
export interface ReviewDiskState {
  storage: string
  exclude: boolean
  /** Forced target bus (#1000, warm only); absent or 'auto' keeps the engine's rule. */
  bus?: MigrationDiskBus
}

export interface ReviewHardwareState {
  cores: string
  sockets: string
  memoryMB: string
}

/** One row of the NIC table; '' for vlanTag or model means "default". */
export interface ReviewNicState {
  bridge: string
  vlanTag: string
  model: string
}

/**
 * The hardware the source would hand over untouched: Proxmox `cores` is the
 * per-socket count, as configMapper derives it (`numCoresPerSocket`, else the
 * total vCPU count).
 */
export function sourceHardware(source: ReviewSource | null | undefined): { cores: number; sockets: number; memoryMB: number } {
  if (!source) return { cores: 0, sockets: 0, memoryMB: 0 }
  const cores = source.numCoresPerSocket > 0 ? source.numCoresPerSocket : source.numCPU
  return { cores: cores || 1, sockets: source.sockets || 1, memoryMB: source.memoryMB || 0 }
}

export function initialHardwareState(source: ReviewSource | null | undefined): ReviewHardwareState {
  const hw = sourceHardware(source)
  return { cores: String(hw.cores || ''), sockets: String(hw.sockets || ''), memoryMB: String(hw.memoryMB || '') }
}

/** One row per source NIC, all on the dialog's default bridge and tag. */
export function initialNicState(source: ReviewSource | null | undefined, defaultBridge: string, defaultVlanTag: string): ReviewNicState[] {
  return (source?.nics ?? []).map(() => ({ bridge: defaultBridge, vlanTag: defaultVlanTag, model: '' }))
}

/** One row per source disk, all on the dialog's target storage and all migrated. */
export function initialDiskState(source: ReviewSource | null | undefined, defaultStorage: string): ReviewDiskState[] {
  return (source?.disks ?? []).map(() => ({ storage: defaultStorage, exclude: false }))
}

/**
 * The disks the job will copy, with their position in the source list and
 * their storage. Disk 0 is the boot disk and is kept whatever its row says,
 * as the API and planDiskTargets do.
 */
export function keptReviewDisks(disks: ReviewDiskState[]): { index: number; storage: string }[] {
  return disks
    .map((d, index) => ({ index, storage: d.storage, kept: index === 0 || !d.exclude }))
    .filter(d => d.kept)
    .map(({ index, storage }) => ({ index, storage }))
}

/**
 * The distinct storages the job writes disks to: those of the kept rows in
 * the review step, or the default storage alone when the step has no row
 * (source not read yet, or outside the review step). Blank rows are left out;
 * they already block the launch.
 */
export function reviewDiskStorages(disks: ReviewDiskState[], defaultStorage: string): string[] {
  const kept = keptReviewDisks(disks)
  if (kept.length === 0) return defaultStorage ? [defaultStorage] : []
  return [...new Set(kept.map(k => k.storage.trim()).filter(Boolean))]
}

/**
 * The storage type the cold temp-space rule should assume for a set of
 * targets: a disk bound for a block storage is staged twice on the temporary
 * storage (download, then converted image), so one block target among the
 * kept disks makes requiredTempBytes count the whole run twice; only when
 * every kept disk goes to a file-based storage does the 1x rule hold. An
 * unknown type counts as block, as requiredTempBytes already treats it.
 */
export function tempStorageTypeFor(types: (string | undefined)[]): string | undefined {
  if (types.length === 0) return undefined
  const block = types.findIndex(t => !t || !isFileBasedStorage(t))
  return block >= 0 ? types[block] : types[0]
}

type HardwareField = keyof ReviewHardwareState

function fieldValue(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) ? n : Number.NaN
}

/** Fields whose value is outside the Proxmox limits (blank is allowed and means "source value"). */
export function hardwareErrors(hw: ReviewHardwareState): Record<HardwareField, boolean> {
  const check = (field: HardwareField) => {
    const n = fieldValue(hw[field])
    if (n === null) return false
    const { min, max } = HARDWARE_LIMITS[field]
    return !Number.isInteger(n) || n < min || n > max
  }
  return { cores: check('cores'), sockets: check('sockets'), memoryMB: check('memoryMB') }
}

export function vlanTagInvalid(raw: string): boolean {
  if (raw.trim() === '') return false
  const n = Number(raw)
  return !Number.isInteger(n) || n < 1 || n > 4094
}

/** Every disk the job copies names its storage; an excluded disk needs none. */
export function disksValid(disks: ReviewDiskState[]): boolean {
  return keptReviewDisks(disks).every(k => k.storage.trim() !== '')
}

export function reviewIsValid(hw: ReviewHardwareState, nics: ReviewNicState[], disks: ReviewDiskState[] = []): boolean {
  const errors = hardwareErrors(hw)
  if (errors.cores || errors.sockets || errors.memoryMB) return false
  if (!disksValid(disks)) return false
  return nics.every(n => n.bridge.trim() !== '' && !vlanTagInvalid(n.vlanTag))
}

/**
 * The `hardware` field of the request: only the values that differ from the
 * source, so a job config stays readable and a retry re-applies exactly what
 * the operator changed. Undefined when nothing changed.
 */
export function buildHardwarePayload(hw: ReviewHardwareState, source: ReviewSource | null | undefined): MigrationHardwareOverrides | undefined {
  const base = sourceHardware(source)
  const out: MigrationHardwareOverrides = {}
  for (const field of ['cores', 'sockets', 'memoryMB'] as const) {
    const n = fieldValue(hw[field])
    if (n === null || Number.isNaN(n)) continue
    if (n !== base[field]) out[field] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The `nics` field of the request: every source NIC with its chosen bridge,
 * so the mapping persisted in the job never depends on what the default
 * bridge was at the time. Undefined when the source has no NIC.
 */
export function buildNicsPayload(nics: ReviewNicState[], canEditVlan: boolean): MigrationNicMapping[] | undefined {
  if (nics.length === 0) return undefined
  return nics.map((n, index) => {
    const m: MigrationNicMapping = { index, bridge: n.bridge.trim() }
    if (canEditVlan && n.vlanTag.trim() !== '' && !vlanTagInvalid(n.vlanTag)) m.vlanTag = Number(n.vlanTag)
    if (n.model) m.model = n.model
    return m
  })
}

/**
 * The `disks` field of the request: every source disk with its chosen
 * storage, so the mapping persisted in the job never depends on what the
 * default storage was at the time, and `exclude` on the disks left out. Disk
 * 0 is never excluded (the API refuses it). Undefined when the source has no disk.
 */
export function buildDisksPayload(disks: ReviewDiskState[], opts: { withBus?: boolean } = {}): MigrationDiskMapping[] | undefined {
  if (disks.length === 0) return undefined
  return disks.map((d, index) => {
    if (d.exclude && index !== 0) return { index, exclude: true }
    // The bus only travels where the engine applies it (warm from VMware).
    return { index, targetStorage: d.storage.trim(), ...(opts.withBus && d.bus && d.bus !== 'auto' && { bus: d.bus }) }
  })
}

/** Windows guest, by vSphere's guest OS name (the engine also checks the guest id). */
export function isWindowsSource(source: ReviewSource | null | undefined): boolean {
  return /windows/i.test(source?.guestOS || '')
}

/**
 * The bus "Auto" gives the boot disk (#1000): VirtIO SCSI once the guest is
 * converted at cutover, otherwise SATA for a Windows or UEFI guest (inbox
 * drivers) and SCSI for a BIOS Linux, the engine's rule for a SCSI source disk.
 */
export function autoBootBus(source: ReviewSource | null | undefined, convertGuest: boolean): 'scsi' | 'sata' {
  if (convertGuest) return 'scsi'
  return source?.firmware === 'efi' || isWindowsSource(source) ? 'sata' : 'scsi'
}

/**
 * Forcing the boot disk onto SCSI without converting the guest only boots a
 * guest that already carries the VirtIO SCSI driver in its initramfs (Linux)
 * or as a boot-start driver (Windows): the review step says so.
 */
export function scsiBootNeedsDrivers(disks: ReviewDiskState[], convertGuest: boolean): boolean {
  return !convertGuest && disks[0]?.bus === 'scsi'
}

export interface StorageNeed {
  storage: string
  requiredBytes: number
}

/**
 * Bytes each target storage must hold for a warm run. vSphere only reports
 * the committed size of the whole VM, so it is apportioned to the kept disks
 * by their share of the total capacity and summed per storage: every disk on
 * the default storage asks exactly what the step-1 check asks, and the share
 * of an excluded disk is not asked for. Without any row the default storage
 * takes everything, as before the review step existed.
 */
export function warmSpaceNeeds(
  disks: ReviewDiskState[],
  source: ReviewSource | null | undefined,
  committedBytes: number,
  defaultStorage: string,
): StorageNeed[] {
  const committed = Math.max(0, committedBytes || 0)
  const kept = keptReviewDisks(disks).filter(k => k.storage.trim() !== '')
  if (kept.length === 0) return defaultStorage ? [{ storage: defaultStorage, requiredBytes: committed }] : []
  const capacities = (source?.disks ?? []).map(d => Math.max(0, d.capacityBytes || 0))
  const total = capacities.reduce((sum, c) => sum + c, 0)
  // Capacity per storage first, so a single storage holding every disk gets
  // total/total = 1 exactly rather than a sum of rounded fractions.
  const perStorage = new Map<string, number>()
  for (const k of kept) {
    const weight = total > 0 ? (capacities[k.index] ?? 0) : 1
    perStorage.set(k.storage, (perStorage.get(k.storage) ?? 0) + weight)
  }
  const divisor = total > 0 ? total : kept.length
  return [...perStorage.entries()].map(([storage, weight]) => ({ storage, requiredBytes: Math.round(committed * (weight / divisor)) }))
}

/** The quick models of the migration dialog first, then the node's own list, without duplicates. */
export function mergeCpuModels(quick: readonly string[], fromNode: unknown): string[] {
  const names: string[] = []
  if (Array.isArray(fromNode)) {
    for (const raw of fromNode) {
      const entry = raw as { name?: unknown; custom?: unknown } | null
      const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
      if (!name) continue
      const isCustom = entry?.custom === 1 || entry?.custom === true || name.startsWith('custom-')
      names.push(isCustom && !name.startsWith('custom-') ? `custom-${name}` : name)
    }
  }
  const rest = [...new Set(names)].filter(n => !quick.includes(n)).sort((a, b) => a.localeCompare(b))
  return [...quick, ...rest]
}
