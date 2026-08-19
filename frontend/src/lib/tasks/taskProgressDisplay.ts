/**
 * Pure display helpers for the shared-task detail readout (speed parsing, ETA,
 * step labels). Kept out of SharedTaskDetailDialog so every branch is
 * unit-testable; the component only assembles the pieces.
 */

/**
 * Parse the migration pipelines' transferSpeed strings into a MB/s number.
 * Handles the bare form ("64 MB/s") and prefixed forms ("Zeroing: 80 MB/s"),
 * plus the MiB/s spelling some fixtures use. Null when absent or unparseable.
 */
export function parseSpeedMBps(speed: string | null): number | null {
  if (!speed) return null
  const m = /(\d+(?:\.\d+)?)\s*M(?:i)?B\/s/i.exec(speed)
  if (!m) return null
  const v = Number.parseFloat(m[1])
  return Number.isFinite(v) ? v : null
}

/**
 * Remaining seconds for a transfer, from the byte counters and a MB/s speed
 * (MB = 1048576 bytes, matching how the pipelines compute their speed strings).
 * Null on any missing/zero/negative input or when the transfer is already done.
 */
export function etaSeconds(bytesTransferred: number | null, totalBytes: number | null, speedMBps: number | null): number | null {
  if (bytesTransferred == null || totalBytes == null || speedMBps == null) return null
  if (bytesTransferred < 0 || totalBytes <= 0 || speedMBps <= 0) return null
  if (bytesTransferred >= totalBytes) return null
  return (totalBytes - bytesTransferred) / (speedMBps * 1048576)
}

/** Compact duration: "45s" under a minute, "12m" under an hour, then "3h 12m". */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

// Steps the pipelines write to migrationJob.currentStep that have a stable
// translation under tasks.steps.*. Warm: planning…converting_disks (delta
// passes are numbered, see below). Cold/v2v: preflight…awaiting_root_choice.
const KNOWN_STEPS = new Set([
  "planning", "enabling_cbt", "preparing_disks", "full_copy", "source_shutdown",
  "awaiting_cutover", "cutover", "verify", "converting_disks",
  "preflight", "transferring", "creating_vm", "configuring", "pending",
  "awaiting_root_choice",
])

/**
 * Map a job's currentStep to its tasks.steps.* key suffix. Numbered delta
 * passes (delta_1, delta_2, …) collapse to "delta". Unknown steps return null
 * so the caller can fall back to showing the raw string.
 */
export function stepLabelKey(currentStep: string | null): string | null {
  if (!currentStep) return null
  if (/^delta_\d+$/.test(currentStep)) return "delta"
  return KNOWN_STEPS.has(currentStep) ? currentStep : null
}
