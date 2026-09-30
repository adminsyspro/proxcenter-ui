/** Disk sizes as PVE writes them in a guest config (`scsi0: local:vm-1-disk-0,size=32G`). */

export const GIB = 1024 ** 3

const UNIT_BYTES: Record<string, number> = { K: 1024, M: 1024 ** 2, G: GIB, T: 1024 ** 4 }

// Same grammar as PVE::JSONSchema::parse_size: an optional binary unit, with or
// without the `iB` suffix, and plain bytes when there is none. PVE writes the
// largest unit that divides the size evenly, so an EFI vars disk reads `528K`
// and a unit-less figure is bytes, never gigabytes (#1036).
const PVE_SIZE_RE = /^(\d+(?:\.\d+)?)(?:([KMGT])(?:iB)?)?$/i

/** "528K" | "4M" | "32G" | "1.5T" | "1048576" -> bytes. 0 when unparseable. */
export function parsePveSize(size: unknown): number {
  const m = PVE_SIZE_RE.exec(String(size ?? '').trim())
  if (!m) return 0

  return Math.round(Number.parseFloat(m[1]) * (m[2] ? UNIT_BYTES[m[2].toUpperCase()] : 1))
}

/** The `size=` option of a drive string, in bytes. 0 when absent or unparseable. */
export function pveDriveSize(drive: unknown): number {
  const size = String(drive ?? '').split(',').find(option => option.startsWith('size='))

  return size ? parsePveSize(size.slice(5)) : 0
}
