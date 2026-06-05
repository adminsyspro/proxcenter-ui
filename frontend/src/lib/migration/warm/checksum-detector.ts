import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { Extent } from "./extents"

/**
 * Diff two ordered lists of fixed-block checksums and return one extent per
 * block whose source hash differs from the target hash. A block present in the
 * source scan but missing from the (shorter) target scan counts as changed, so
 * an under-populated target gets fully copied. Extents are emitted per block;
 * the applier (normalizeExtents) merges adjacent ones and clamps the tail to
 * the disk length. Pure — no I/O.
 */
export function diffChecksums(srcSums: string[], dstSums: string[], blockSize: number): Extent[] {
  const out: Extent[] = []
  for (let i = 0; i < srcSums.length; i++) {
    if (srcSums[i] !== dstSums[i]) out.push({ offset: i * blockSize, length: blockSize })
  }
  return out
}

/**
 * Build a shell command that prints the md5 of each fixed `blockSize` block of
 * `device`, one hash per line, for blocks 0..numBlocks-1. md5 is used purely as
 * a change-detector (not for security); the last block may be short and is
 * hashed as read. The device path is system-generated but escaped defensively.
 */
export function buildBlockChecksumCmd(device: string, blockSize: number, numBlocks: number): string {
  return `for i in $(seq 0 ${numBlocks - 1}); do ` +
    `dd if=${shellEscape(device)} bs=${blockSize} skip=$i count=1 2>/dev/null | md5sum | cut -d' ' -f1; done`
}

/**
 * Compute per-block checksums of a device on the PVE node. Returns one hash per
 * block (0..numBlocks-1). numBlocks <= 0 short-circuits to an empty list.
 */
export async function scanBlockChecksums(
  connectionId: string,
  nodeIp: string,
  device: string,
  blockSize: number,
  numBlocks: number,
): Promise<string[]> {
  if (numBlocks <= 0) return []
  // The whole disk is scanned block-by-block, which on a multi-TB disk can run
  // for many minutes; this is the no-CBT fallback where downtime scales with
  // disk size. Give it a generous timeout.
  const res = await executeSSH(connectionId, nodeIp, buildBlockChecksumCmd(device, blockSize, numBlocks), 6 * 60 * 60 * 1000)
  if (!res.success) throw new Error(`block checksum scan failed on ${device}: ${res.error || res.output}`)
  return (res.output || "").split("\n").map(s => s.trim()).filter(Boolean)
}

/**
 * Checksum fallback detector. Hashes fixed blocks of the source (via the VDDK
 * NBD device) and the target raw device, then returns the changed extents for
 * the applier. Universal and lossless; used when CBT is ineligible or its
 * change map is invalid. The source is stopped (snapshot) before scanning by
 * the caller so the hashes are consistent.
 */
export async function detectChangedExtentsByChecksum(
  connectionId: string,
  nodeIp: string,
  srcDevice: string,
  dstDevice: string,
  blockSize: number,
  diskLength: number,
): Promise<Extent[]> {
  const numBlocks = Math.ceil(diskLength / blockSize)
  const [srcSums, dstSums] = await Promise.all([
    scanBlockChecksums(connectionId, nodeIp, srcDevice, blockSize, numBlocks),
    scanBlockChecksums(connectionId, nodeIp, dstDevice, blockSize, numBlocks),
  ])
  return diffChecksums(srcSums, dstSums, blockSize)
}
