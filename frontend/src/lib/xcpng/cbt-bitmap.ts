import type { Extent } from "@/lib/migration/warm/extents"

/** XAPI CBT granularity: VDI.list_changed_blocks reports one bit per 64 KiB block. */
export const CBT_BLOCK_SIZE = 65536

/**
 * Decode the base64 bitmap returned by VDI.list_changed_blocks into byte extents.
 * Bit i (most significant bit of each byte first) covers [i*blockSize, (i+1)*blockSize).
 * Consecutive set bits are merged; extents are clamped to diskBytes.
 */
export function cbtBitmapToExtents(b64: string, diskBytes: number, blockSize = CBT_BLOCK_SIZE): Extent[] {
  const bm = Buffer.from(b64, "base64")
  const out: Extent[] = []
  const nbits = bm.length * 8
  let start = -1
  for (let i = 0; i < nbits; i++) {
    const set = (bm[i >> 3] >> (7 - (i & 7))) & 1
    if (set && start < 0) start = i
    if (!set && start >= 0) { out.push({ offset: start * blockSize, length: (i - start) * blockSize }); start = -1 }
  }
  if (start >= 0) out.push({ offset: start * blockSize, length: (nbits - start) * blockSize })
  return out
    .filter(e => e.offset < diskBytes)
    .map(e => ({ offset: e.offset, length: Math.min(e.length, diskBytes - e.offset) }))
}
