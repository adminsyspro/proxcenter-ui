/**
 * State and payload helpers of the migration review step (#317, lot 1).
 *
 * The review step shows the hardware and the NICs read from the source VM
 * and lets the operator change the target values. Everything the step edits
 * is kept as strings (what the inputs hold); these helpers build the initial
 * state from the source VM, validate it, and turn it into the `hardware` and
 * `nics` fields of POST /api/v1/migrations. Pure, so the node test project
 * covers them without rendering.
 */

import { HARDWARE_LIMITS, type MigrationHardwareOverrides, type MigrationNicMapping } from '@/lib/migration/target-overrides'

export interface ReviewSourceNic {
  label: string
  type: string
  macAddress: string
  network: string
}

/** What the review step needs from GET /api/v1/vmware/[id]/vms/[vmid]. */
export interface ReviewSource {
  numCPU: number
  numCoresPerSocket: number
  sockets: number
  memoryMB: number
  nics: ReviewSourceNic[]
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

export function reviewIsValid(hw: ReviewHardwareState, nics: ReviewNicState[]): boolean {
  const errors = hardwareErrors(hw)
  if (errors.cores || errors.sockets || errors.memoryMB) return false
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
