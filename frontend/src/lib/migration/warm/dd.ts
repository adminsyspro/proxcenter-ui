import { shellEscape } from "@/lib/ssh/exec"
import type { Extent } from "./extents"

/**
 * Build a byte-accurate dd command that copies one extent from a source
 * (e.g. a qemu-nbd device exposing the snapshot's logical view) to a raw
 * target block device at the same offset. Byte-unit flags are mandatory:
 * a seek in the wrong unit silently corrupts the target.
 */
export function buildDeltaApplyCmd(src: string, dst: string, e: Extent, blockBytes = 4 * 1024 * 1024): string {
  // `status=progress` makes dd write a progress line to stderr (~1/s). With the
  // trailing `2>&1` those lines reach the reader's stdout, which (a) keeps the
  // SSH control channel from going idle during a multi-hour copy and (b) lets the
  // orchestrator log live per-disk throughput and detect a genuine stall (#445).
  return `dd if=${shellEscape(src)} of=${shellEscape(dst)} bs=${blockBytes} ` +
    `iflag=skip_bytes,count_bytes oflag=seek_bytes,direct conv=notrunc status=progress ` +
    `skip=${e.offset} count=${e.length} seek=${e.offset} 2>&1`
}
