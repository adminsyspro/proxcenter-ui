/**
 * Operator overrides applied to the VM a migration creates (#317, lot 1).
 *
 * Two families, both optional and both persisted in `job.config` so a retry
 * rebuilds the same VM:
 * - `hardware`: cores, sockets and memory of the target, when the operator
 *   right-sizes the VM at migration time instead of inheriting the source;
 * - `nics`: one target bridge (physical bridge or SDN VNet), optional VLAN tag
 *   and optional model per source NIC, by position in the source NIC list. A
 *   NIC without a mapping falls back to the dialog's default bridge and tag.
 *
 * The route validates everything here before the values reach `qm create`; the
 * mappers only apply what they are given.
 */

import { isKnownCpuType } from "@/lib/inventory/cpuModels"

export interface MigrationNicMapping {
  /** Position of the NIC in the source VM's NIC list (0 = first adapter). */
  index: number
  /** Target bridge or SDN VNet name, as `bridge=` expects it. */
  bridge: string
  /** 802.1Q tag for this NIC, 1 to 4094; absent means the bridge's native VLAN. */
  vlanTag?: number
  /** Proxmox NIC model; absent means the model the mapper derives from the source adapter. */
  model?: string
}

export interface MigrationHardwareOverrides {
  cores?: number
  sockets?: number
  memoryMB?: number
}

export interface MigrationTargetOverrides {
  nics?: MigrationNicMapping[]
  hardware?: MigrationHardwareOverrides
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
    out.push(nic)
  }
  out.sort((a, b) => a.index - b.index)
  return { ok: true, value: out.length > 0 ? out : undefined }
}

/**
 * CPU model accepted for `qm create --cpu`: a QEMU model Proxmox knows, or a
 * cluster-defined `custom-<name>` model. Anything else never reaches the node.
 */
export function isAcceptableCpuType(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false
  return isKnownCpuType(value) || /^custom-[A-Za-z0-9_.-]+$/.test(value)
}

/** The mapping of one NIC, or the dialog defaults when the operator left it alone. */
export function resolveNicTarget(
  index: number,
  nics: MigrationNicMapping[] | undefined,
  defaults: { bridge: string; vlanTag?: number },
): { bridge: string; vlanTag?: number; model?: string } {
  const m = nics?.find(n => n.index === index)
  if (!m) return { bridge: defaults.bridge, vlanTag: defaults.vlanTag }
  return { bridge: m.bridge, vlanTag: m.vlanTag ?? defaults.vlanTag, model: m.model }
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
    if (hwParts.length > 0) parts.push(`hardware ${hwParts.join(", ")}`)
  }
  if (overrides.nics && overrides.nics.length > 0) {
    parts.push(`NICs ${overrides.nics.map(n => `net${n.index}->${n.bridge}${n.vlanTag ? ` tag ${n.vlanTag}` : ""}${n.model ? ` (${n.model})` : ""}`).join(", ")}`)
  }
  return parts.length > 0 ? `Operator overrides: ${parts.join("; ")}` : null
}
