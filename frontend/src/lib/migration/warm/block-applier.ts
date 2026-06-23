import { normalizeExtents, type Extent } from "./extents"
import { buildDeltaApplyCmd } from "./dd"

/**
 * Max bytes for one delta-apply command. Linux caps a *single* execve argument
 * at MAX_ARG_STRLEN (PAGE_SIZE * 32 = 128 KiB), independent of the much larger
 * total ARG_MAX. The apply script is sent as one `sudo sh -c '<script>'`
 * argument over SSH, and single-quote escaping inflates it further, so we keep
 * each command well under 128 KiB. Batching every dd into one command broke
 * disk 0 of a busy 1.43 TB VM (707 dd lines = 158 KB > 128 KiB): the remote exec
 * was rejected before any dd ran and the SSH channel closed without a reply,
 * surfacing as an opaque "command failed: EOF" (adminsyspro/proxcenter-ui#445).
 */
export const MAX_APPLY_CMD_BYTES = 96 * 1024

const HEADER = "set -e"

/**
 * Build the shell command(s) that apply every changed extent from the NBD device
 * (the snapshot's logical view, served by nbdkit-vddk) to the raw Proxmox block
 * target. Extents are aligned to `alignment` and clamped to `diskLength` first
 * (so direct-I/O writes land on aligned boundaries and no tail runs past EOF),
 * then merged, so adjacent CBT extents collapse into a single dd.
 *
 * The dd lines are packed into one or more commands, each kept under
 * MAX_APPLY_CMD_BYTES so a large change set never produces an oversized command
 * (see that constant). Every command is prefixed with `set -e` so a dd failure
 * aborts that command immediately; the caller runs the commands in order and
 * stops on the first failure, preserving the original abort-on-first-error
 * semantics across the split. An empty change set yields no commands.
 */
export function buildApplyScripts(
  nbdDev: string,
  targetDev: string,
  extents: Extent[],
  diskLength: number,
  alignment = 1024 * 1024,
): string[] {
  const norm = normalizeExtents(extents, alignment, diskLength)
  const scripts: string[] = []
  let lines = [HEADER]
  let size = HEADER.length
  for (const e of norm) {
    const line = buildDeltaApplyCmd(nbdDev, targetDev, e)
    // +1 for the newline that join() inserts before this line. Flush the current
    // command before it would cross the budget, but never emit a header-only
    // command (lines.length > 1 guarantees at least one dd is already buffered).
    if (lines.length > 1 && size + 1 + line.length > MAX_APPLY_CMD_BYTES) {
      scripts.push(lines.join("\n"))
      lines = [HEADER]
      size = HEADER.length
    }
    lines.push(line)
    size += 1 + line.length
  }
  if (lines.length > 1) scripts.push(lines.join("\n"))
  return scripts
}
