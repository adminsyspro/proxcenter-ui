export interface Extent { offset: number; length: number }

/**
 * Sort, optionally align to a block boundary, optionally clamp to a disk length,
 * then merge overlapping and adjacent extents into a minimal disjoint set.
 * Alignment rounds each extent's start down and end up to the block size (so
 * direct-I/O writes land on aligned boundaries); alignment <= 0 disables it.
 * diskLength > 0 clamps every extent's end so an aligned tail cannot run past EOF.
 */
export function normalizeExtents(extents: Extent[], alignment = 0, diskLength = 0): Extent[] {
  const aligned = extents
    .map(e => {
      let start = e.offset
      let end = e.offset + e.length
      if (alignment > 0) {
        start = Math.floor(e.offset / alignment) * alignment
        end = Math.ceil((e.offset + e.length) / alignment) * alignment
      }
      if (diskLength > 0 && end > diskLength) end = diskLength
      return { offset: start, length: Math.max(0, end - start) }
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
