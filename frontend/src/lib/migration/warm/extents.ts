export interface Extent { offset: number; length: number }

/**
 * Sort, optionally align to a block boundary, then merge overlapping and
 * adjacent extents into a minimal disjoint set. Alignment rounds each extent's
 * start down and end up to the given block size (so direct-I/O writes land on
 * aligned boundaries); alignment <= 0 disables it.
 */
export function normalizeExtents(extents: Extent[], alignment = 0): Extent[] {
  const aligned = extents
    .map(e => {
      if (alignment <= 0) return { offset: e.offset, length: e.length }
      const start = Math.floor(e.offset / alignment) * alignment
      const end = Math.ceil((e.offset + e.length) / alignment) * alignment
      return { offset: start, length: end - start }
    })
    .filter(e => e.length > 0)
    .sort((a, b) => a.offset - b.offset)

  const out: Extent[] = []
  for (const e of aligned) {
    const last = out[out.length - 1]
    if (last && e.offset <= last.offset + last.length) {
      last.length = Math.max(last.length, e.offset + e.length - last.offset)
    } else {
      out.push({ ...e })
    }
  }
  return out
}
