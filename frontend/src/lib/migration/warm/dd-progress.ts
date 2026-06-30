/**
 * Parse the progress/summary line emitted by `dd status=progress`.
 *
 * GNU coreutils dd prints, periodically (separated by carriage returns) and once
 * more as the final summary:
 *
 *   1073741824 bytes (1.1 GB, 1.0 GiB) copied, 12.3 s, 87.3 MB/s
 *
 * We extract the authoritative byte count and elapsed seconds (and derive the
 * rate ourselves, so we don't depend on dd's human-readable unit). Used to (a)
 * reset the SSH inactivity timer while a copy is genuinely moving and (b) surface
 * live per-disk throughput in the migration log.
 */
export interface DdProgress {
  bytes: number
  seconds: number
  bytesPerSec: number
}

// `\d+` and `[\d.]+` only — no nested quantifiers (ReDoS-safe, Sonar S5852).
const PROGRESS_RE = /(\d+) bytes (?:\([^)]*\) )?copied, ([\d.]+) s/g

/**
 * Return the LAST progress match in `text` (dd overwrites the same line via \r,
 * so a chunk may carry several; the most recent one is the live figure), or null
 * when the text contains no dd progress line.
 */
export function parseDdProgress(text: string): DdProgress | null {
  let last: RegExpExecArray | null = null
  for (let m = PROGRESS_RE.exec(text); m !== null; m = PROGRESS_RE.exec(text)) last = m
  PROGRESS_RE.lastIndex = 0
  if (!last) return null
  const bytes = Number(last[1])
  const seconds = Number(last[2])
  const bytesPerSec = seconds > 0 ? bytes / seconds : 0
  return { bytes, seconds, bytesPerSec }
}
