import { normalizeExtents, type Extent } from "./extents"
import { buildDeltaApplyCmd } from "./dd"

/**
 * Build a shell script that applies every changed extent from the NBD device
 * (the snapshot's logical view, served by nbdkit-vddk) to the raw Proxmox block
 * target. Extents are aligned to `alignment` and clamped to `diskLength` first
 * (so direct-I/O writes land on aligned boundaries and no tail runs past EOF),
 * then merged, so adjacent CBT extents collapse into a single dd. `set -e`
 * aborts on the first dd failure rather than silently leaving a partial copy.
 */
export function buildApplyScript(
  nbdDev: string,
  targetDev: string,
  extents: Extent[],
  diskLength: number,
  alignment = 1024 * 1024,
): string {
  const norm = normalizeExtents(extents, alignment, diskLength)
  const lines = ["set -e"]
  for (const e of norm) lines.push(buildDeltaApplyCmd(nbdDev, targetDev, e))
  return lines.join("\n")
}
