/**
 * Progress parsers for virt-v2v and pv (pipe viewer) output.
 *
 * virt-v2v with --machine-readable interleaves TWO output formats:
 *
 *   1. JSON events (one per line), e.g.:
 *        { "message": "Inspecting the source", "timestamp": "...", "type": "message" }
 *        { "message": "Copying disk 1/2",       "timestamp": "...", "type": "message" }
 *        { "message": "virt-v2v: error: ...",   "timestamp": "...", "type": "error" }
 *      "type" is one of message | warning | error | info.
 *
 *   2. Human-readable lines mirroring the JSON, e.g.:
 *        [   0.0] Setting up the source: ...
 *        [  14.5] Mapping filesystem data to avoid copying unused and blank areas
 *      The number in brackets is ELAPSED SECONDS, NOT a percentage. The
 *      previous version of this parser treated it as a percent and matched
 *      nothing useful, which is why the migration progress bar was stuck at 0%.
 *
 * virt-v2v does not emit a continuous percent-complete number for the whole
 * run; the authoritative progress is "which phase are we in". We map known
 * phase-transition messages to approximate percents so the UI progress bar
 * at least moves in meaningful steps. Not exact, but useful.
 *
 * pv emits lines like:
 *   1.23GiB 0:01:30 [ 120MiB/s] [========>               ] 45% ETA 0:01:50
 */

export interface V2vProgress {
  /** Approximate overall percent (0-100), derived from phase. */
  percent: number
  /** 1-indexed; only meaningful during "Copying disk N/M". */
  currentDisk: number
  /** Total disk count; only meaningful during "Copying disk N/M". */
  totalDisks: number
  /** Human-readable phase name, surface this in the UI. */
  step: string
}

export interface PvProgress {
  percent: number
  transferred: string
  speed: string
  eta: string
}

/**
 * Known virt-v2v phase prefixes mapped to an approximate overall percent.
 * Order matters for the "starts-with" match below. Percents are monotonic.
 * The actual phase names come from virt-v2v's source (`setup_source`, etc.)
 * but what we see in output is the human-readable message; we match on that.
 *
 * During "Copying disk N/M" we override the mapping and compute a finer
 * percent using the (offset/total) progress events virt-v2v emits.
 */
const V2V_PHASE_MAP: { prefix: string; percent: number }[] = [
  { prefix: "Setting up the source", percent: 5 },
  { prefix: "Opening the source", percent: 10 },
  { prefix: "Inspecting the source", percent: 15 },
  { prefix: "Checking for sufficient free disk space", percent: 20 },
  { prefix: "Converting ", percent: 25 }, // "Converting X to run on KVM"
  { prefix: "Mapping filesystem data", percent: 35 },
  { prefix: "Closing the overlay", percent: 85 },
  { prefix: "Assigning disks to buses", percent: 88 },
  { prefix: "Checking if the guest needs BIOS or UEFI", percent: 90 },
  { prefix: "Setting up the destination", percent: 92 },
  { prefix: "Copying disk", percent: 40 }, // overridden below when we have %
  { prefix: "Creating output metadata", percent: 97 },
  { prefix: "Finishing off", percent: 99 },
]

// Message format (JSON event + mirrored human line):
//   { "message": "...", "timestamp": "...", "type": "message" }
//   [   45.5] message content
// Progress events during "Copying disk N/M" look like either:
//   { "type": "progress", "offset": N, "total": M }        — newer virt-v2v
//   (45.5/100%)                                            — older virt-v2v
const V2V_JSON_MESSAGE_RE = /"message"\s*:\s*"([^"]+)"/
const V2V_JSON_PROGRESS_RE = /"offset"\s*:\s*(\d+)\s*,\s*"total"\s*:\s*(\d+)/
const V2V_HUMAN_LINE_RE = /^\[\s*[\d.]+\]\s+(.+)$/
const V2V_OLD_PROGRESS_RE = /\(([\d.]+)\/100%\)/
const V2V_DISK_RE = /Copying disk (\d+)\/(\d+)/

/**
 * Parse a single virt-v2v output line into structured progress.
 * Returns null for lines that don't carry useful progress info
 * (blank lines, stderr noise, etc).
 *
 * Handles four formats in priority order:
 *   1. JSON progress events {"type":"progress","offset":N,"total":M}
 *   2. JSON message events  {"message":"...","type":"message"}
 *   3. Human-readable        [ 45.5] Copying disk 1/2
 *   4. Legacy percent        (45.5/100%)
 */
export function parseV2vLine(line: string): V2vProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // State carried across lines: remember the last "Copying disk N/M" message
  // so a subsequent progress event can be scaled across the right disk.
  // We can't actually do this statefully here (parseV2vLine is stateless);
  // we extract the disk count per match when available and default to 1/1
  // otherwise. processV2vOutput runs many lines together so it's fine.

  // 1. JSON progress event (newer virt-v2v)
  const jsonProg = trimmed.match(V2V_JSON_PROGRESS_RE)
  if (jsonProg) {
    const offset = parseInt(jsonProg[1], 10)
    const total = parseInt(jsonProg[2], 10)
    const pct = total > 0 ? (offset / total) * 100 : 0
    return { percent: pct, currentDisk: 1, totalDisks: 1, step: "Copying disk" }
  }

  // 2. JSON message event — use phase map for percent
  const jsonMsg = trimmed.match(V2V_JSON_MESSAGE_RE)
  if (jsonMsg) {
    return progressFromStep(jsonMsg[1].trim())
  }

  // 3. Human-readable bracketed line
  const humanMatch = trimmed.match(V2V_HUMAN_LINE_RE)
  if (humanMatch) {
    return progressFromStep(humanMatch[1].trim())
  }

  // 4. Legacy percent format during disk copy
  const oldProg = trimmed.match(V2V_OLD_PROGRESS_RE)
  if (oldProg) {
    return { percent: parseFloat(oldProg[1]), currentDisk: 1, totalDisks: 1, step: "Copying disk" }
  }

  return null
}

function progressFromStep(step: string): V2vProgress | null {
  // Skip virt-v2v's informational lines that aren't phase transitions.
  // We only care about lines that look like progress markers.
  const skipPrefixes = ["virt-v2v: ", "This guest has", "The QEMU", "could not "]
  if (skipPrefixes.some(p => step.startsWith(p))) return null

  let currentDisk = 1
  let totalDisks = 1
  const diskMatch = step.match(V2V_DISK_RE)
  if (diskMatch) {
    currentDisk = parseInt(diskMatch[1], 10)
    totalDisks = parseInt(diskMatch[2], 10)
  }

  // Match the phase prefix to get an approximate percent.
  for (const { prefix, percent } of V2V_PHASE_MAP) {
    if (step.startsWith(prefix)) {
      return { percent, currentDisk, totalDisks, step }
    }
  }

  // Unknown step — still return it so the UI shows currentStep text,
  // but don't advance the percent (use 0 as a sentinel the caller ignores).
  return { percent: 0, currentDisk, totalDisks, step }
}

/**
 * Clamp an incoming phase progress to never go backwards. virt-v2v emits
 * the same phase message multiple times (once per disk etc.) and sometimes
 * older percent-format progress shows 0 at the start of each disk; we don't
 * want the UI progress bar to bounce down. Caller keeps a running max.
 *
 * Each disk gets equal weight within the "Copying disk" phase band:
 *   - Band starts at V2V_PHASE_MAP["Copying disk"] = 40
 *   - Band ends just before "Closing the overlay" = 85
 *   - So disk copy contributes up to 45 percentage points total.
 */
export function calculateOverallProgress(v2v: V2vProgress): number {
  // For anything OTHER than "Copying disk", the phase map already gives us
  // the target percent directly.
  if (!v2v.step.startsWith("Copying disk")) {
    return Math.min(100, Math.round(v2v.percent * 10) / 10)
  }
  // Disk copy: map to the 40..85 band, split across disks.
  const COPY_BAND_START = 40
  const COPY_BAND_END = 85
  const band = COPY_BAND_END - COPY_BAND_START
  const weightPerDisk = band / Math.max(1, v2v.totalDisks)
  const completedDisks = Math.max(0, v2v.currentDisk - 1)
  const overall = COPY_BAND_START + completedDisks * weightPerDisk + (v2v.percent / 100) * weightPerDisk
  return Math.min(100, Math.round(overall * 10) / 10)
}

const PV_RE = /^([\d.]+\s*\S+)\s+\d+:\d+:\d+\s+\[\s*([\d.]+\s*\S+)\]\s+\[.*?\]\s+(\d+)%\s+ETA\s+(\S+)/

/**
 * Parse a single pv stderr line into structured progress.
 * Returns null for lines that don't match the pv output pattern.
 */
export function parsePvLine(line: string): PvProgress | null {
  const match = line.match(PV_RE)

  if (!match) return null

  return {
    transferred: match[1].trim(),
    speed: match[2].trim(),
    percent: parseInt(match[3], 10),
    eta: match[4].trim()
  }
}
