// src/lib/proxmox/memoryProperty.ts
//
// PVE stores a guest's RAM in the `memory` config key, which is a property
// string whose default key is `current` (PVE::QemuServer::Memory, $memory_fmt).
// In practice PVE prints it as a bare integer, but the format allows named
// segments next to it, and our panel only ever edits the online amount. Parsing
// it here keeps a property string from landing in a numeric field, and lets a
// write put back the segments we do not own instead of dropping them.

export interface PveMemory {
  /** Online RAM in MiB (PVE's `current`), or null when unreadable. */
  current: number | null
  /** Every other segment, verbatim, so a write can re-emit them. */
  extras: string[]
}

/** Read `8192`, `"8192"`, `"current=8192"` or `"8192,max=32768"` alike. */
export function parseMemoryProperty(raw: unknown): PveMemory {
  if (typeof raw === "number") {
    return { current: Number.isFinite(raw) ? raw : null, extras: [] }
  }
  if (typeof raw !== "string") return { current: null, extras: [] }

  let current: number | null = null
  const extras: string[] = []

  for (const segment of raw.split(",")) {
    const part = segment.trim()

    if (!part) continue

    const eq = part.indexOf("=")
    const key = eq === -1 ? "current" : part.slice(0, eq)
    const value = eq === -1 ? part : part.slice(eq + 1)

    if (key === "current") {
      const parsed = Number(value)

      current = Number.isFinite(parsed) ? parsed : null
    } else {
      extras.push(part)
    }
  }

  return { current, extras }
}

/**
 * Build the `memory` value to write, keeping the segments the caller did not
 * edit. Returns null when there is nothing to preserve, so a caller sending a
 * plain integer against a plain integer keeps sending exactly that.
 */
export function mergeMemoryProperty(previousRaw: unknown, nextCurrent: unknown): string | null {
  const previous = parseMemoryProperty(previousRaw)

  if (previous.extras.length === 0) return null

  const next = parseMemoryProperty(nextCurrent)

  // Nothing usable to merge into, or the caller already spelled out a full
  // property string: leave their value untouched either way.
  if (next.current === null || next.extras.length > 0) return null

  return [`current=${next.current}`, ...previous.extras].join(",")
}
