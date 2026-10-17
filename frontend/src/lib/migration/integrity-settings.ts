// src/lib/migration/integrity-settings.ts
//
// Pure half of the post-copy integrity check (roadmap#1): the knobs the
// Migrations tab of a PVE connection edits and the sampling plan they produce. No I/O
// and no server import, so the client component can import the constants.

export const MIB = 1024 * 1024

/** Spread regions, on top of the first and the last one. */
export const INTEGRITY_REGION_COUNT_DEFAULT = 8
export const INTEGRITY_REGION_COUNT_MAX = 64
/** Size of every sampled region, in MiB. */
export const INTEGRITY_REGION_SIZE_MIB_DEFAULT = 4
export const INTEGRITY_REGION_SIZE_MIB_MAX = 64

export interface IntegritySettings {
  /** Off = the pipelines hand the VM over without hashing anything (logged). */
  enabled: boolean
  /** Regions spread over the disk, in addition to the first and the last one. */
  regionCount: number
  /** Size of each region, MiB. */
  regionSizeMiB: number
}

export const DEFAULT_INTEGRITY_SETTINGS: IntegritySettings = {
  enabled: true,
  regionCount: INTEGRITY_REGION_COUNT_DEFAULT,
  regionSizeMiB: INTEGRITY_REGION_SIZE_MIB_DEFAULT,
}

export interface SampleRegion {
  /** Position in the plan, 0-based; the hash scripts print `R<index> <sha256>`. */
  index: number
  offset: number
  length: number
  kind: "first" | "last" | "spread"
}

/**
 * The regions a disk of `capacityBytes` is sampled on: the first one, the last
 * one, and `regionCount` regions evenly spread between them. Every offset and
 * length is a whole number of MiB, so the same plan works for a byte-addressed
 * reader (dd, curl ranges) and a block-addressed one. A disk too small to hold
 * two regions is sampled as one region from its start; a tail shorter than one
 * MiB is never covered. Pure.
 */
export function planSampleRegions(
  capacityBytes: number,
  settings: Pick<IntegritySettings, "regionCount" | "regionSizeMiB">,
): SampleRegion[] {
  if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) return []
  const size = Math.max(1, Math.floor(settings.regionSizeMiB)) * MIB
  const count = Math.max(0, Math.floor(settings.regionCount))
  const alignedCapacity = Math.floor(capacityBytes / MIB) * MIB
  if (alignedCapacity === 0) return [{ index: 0, offset: 0, length: Math.floor(capacityBytes), kind: "first" }]
  if (alignedCapacity <= 2 * size) {
    return [{ index: 0, offset: 0, length: Math.min(size, alignedCapacity), kind: "first" }]
  }

  const last = alignedCapacity - size
  const picked = new Map<number, SampleRegion["kind"]>([[0, "first"], [last, "last"]])
  for (let k = 1; k <= count; k++) {
    const raw = Math.floor((alignedCapacity * k) / (count + 1))
    const offset = Math.floor(raw / MIB) * MIB
    // Keep clear of the first and the last region; both are always sampled.
    if (offset < size || offset + size > last) continue
    if (!picked.has(offset)) picked.set(offset, "spread")
  }

  const sorted = [...picked.entries()].sort((a, b) => a[0] - b[0])
  const regions: SampleRegion[] = []
  let previousEnd = -1
  for (const [offset, kind] of sorted) {
    // Two spread regions can land closer than one region on a small disk with
    // a high count; the later one is dropped rather than hashed twice.
    if (offset < previousEnd) continue
    regions.push({ index: regions.length, offset, length: size, kind })
    previousEnd = offset + size
  }
  return regions
}

/** `0`, `384 MiB`, `1.5 GiB`: how the job log names an offset or a size. */
export function formatBytesShort(bytes: number): string {
  if (bytes === 0) return "0"
  const gib = bytes / (1024 * MIB)
  if (gib >= 10) return `${gib.toFixed(1)} GiB`
  if (bytes % MIB === 0) return `${bytes / MIB} MiB`
  return `${(bytes / MIB).toFixed(1)} MiB`
}

/**
 * One line naming what the plan covers, for the job log:
 * `10 regions of 4 MiB: first, last and 8 spread (offsets 341 MiB, 682 MiB, ...)`.
 */
export function describeSamplePlan(regions: SampleRegion[]): string {
  if (regions.length === 0) return "no region (empty disk)"
  const size = formatBytesShort(regions[0].length)
  if (regions.length === 1) return `1 region of ${size} at offset 0`
  const spread = regions.filter(r => r.kind === "spread")
  const offsets = spread.map(r => formatBytesShort(r.offset))
  const shown = offsets.length > 6 ? [...offsets.slice(0, 3), "...", ...offsets.slice(-2)] : offsets
  const spreadPart = spread.length > 0 ? ` and ${spread.length} spread (offsets ${shown.join(", ")})` : ""
  return `${regions.length} regions of ${size}: first, last${spreadPart}`
}

/** A connection's columns (null = default) as the settings the pipelines run with. Pure. */
export function integritySettingsFromConnection(c: { integrityCheckEnabled?: boolean | null; integrityRegionCount?: number | null; integrityRegionSizeMiB?: number | null } | null | undefined): IntegritySettings {
  const count = c?.integrityRegionCount
  const size = c?.integrityRegionSizeMiB
  return {
    enabled: c?.integrityCheckEnabled ?? DEFAULT_INTEGRITY_SETTINGS.enabled,
    regionCount: typeof count === "number" && count >= 0 && count <= INTEGRITY_REGION_COUNT_MAX ? count : DEFAULT_INTEGRITY_SETTINGS.regionCount,
    regionSizeMiB: typeof size === "number" && size >= 1 && size <= INTEGRITY_REGION_SIZE_MIB_MAX ? size : DEFAULT_INTEGRITY_SETTINGS.regionSizeMiB,
  }
}

/**
 * Rough time the check adds per disk, in seconds, shown to the operator. It
 * hashes (regionCount + 2) regions on each side; the lab measured 1.0 to 1.6 s
 * for the defaults (40 MiB per side), whatever the disk size, so the estimate
 * scales from 1.5 s per 40 MiB, never below 1 s. 0 when the check is off.
 */
export function estimateIntegritySecondsPerDisk(s: IntegritySettings): number {
  if (!s.enabled) return 0
  const mib = (Math.max(0, s.regionCount) + 2) * Math.max(1, s.regionSizeMiB)
  return Math.max(1, Math.round((mib / 40) * 1.5))
}
