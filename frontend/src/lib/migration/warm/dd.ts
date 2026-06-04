import { shellEscape } from "@/lib/ssh/exec"
import type { Extent } from "./extents"

/**
 * Build a byte-accurate dd command that copies one extent from a source
 * (e.g. a qemu-nbd device exposing the snapshot's logical view) to a raw
 * target block device at the same offset. Byte-unit flags are mandatory:
 * a seek in the wrong unit silently corrupts the target.
 */
export function buildDeltaApplyCmd(src: string, dst: string, e: Extent, blockBytes = 4 * 1024 * 1024): string {
  return `dd if=${shellEscape(src)} of=${shellEscape(dst)} bs=${blockBytes} ` +
    `iflag=skip_bytes,count_bytes oflag=seek_bytes,direct conv=notrunc ` +
    `skip=${e.offset} count=${e.length} seek=${e.offset} 2>&1`
}
