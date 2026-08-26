import { executeSSH } from "@/lib/ssh/exec"
import { buildApplyScripts } from "./block-applier"
import { createDdProgressAccumulator } from "./dd-progress"
import type { Extent } from "./extents"
import type { WarmStatus } from "./types"
import { updateJobLive, appendLog } from "./job-control"

// Long-running SSH operations (block apply, checksum scan) need a generous timeout.
export const APPLY_TIMEOUT_MS = 12 * 60 * 60 * 1000
// Inactivity guard for the block-apply dd (which runs with status=progress, ~1
// line/s): if no output arrives for this long the transfer has genuinely stalled,
// so fail fast instead of waiting out the 12h absolute cap. A healthy copy emits
// progress continuously and never trips it (#445).
export const APPLY_INACTIVITY_MS = 10 * 60 * 1000
// Throttle live throughput log lines so a multi-hour copy doesn't flood the job log.
export const PROGRESS_LOG_INTERVAL_MS = 30_000

/**
 * Map a phase's byte counter onto its window of the warm run's locked progress
 * scale (#502/#606): preparing_disks 0→10, full_copy 10→80, delta passes 80→95,
 * cutover/verify/attach 95→100. Monotonic across the run as long as callers hand
 * it non-decreasing byte counts and contiguous windows. A total of zero means
 * the phase has nothing to do, i.e. it is already complete.
 */
export function scaleWarmProgress(rangeStart: number, rangeEnd: number, doneBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return Math.round(rangeEnd)
  const fraction = Math.min(1, Math.max(0, doneBytes / totalBytes))
  return Math.round(rangeStart + (rangeEnd - rangeStart) * fraction)
}

/**
 * Progress windows for one disk of the checksum fallback on the locked 10→80
 * full_copy scale. Each disk gets an equal slice (span = 70/diskCount); the
 * first 30% of the slice is the checksum scan (reads only, nothing copied yet),
 * the remaining 70% is the block apply. Pure — unit-tested like scaleWarmProgress.
 */
export function checksumDiskWindows(diskIndex: number, diskCount: number): { scanStart: number; scanEnd: number; applyEnd: number } {
  const span = 70 / diskCount
  const scanStart = 10 + span * diskIndex
  return { scanStart, scanEnd: scanStart + 0.3 * span, applyEnd: 10 + span * (diskIndex + 1) }
}

/** One copy pass's slot on the locked progress scale (see scaleWarmProgress). */
export interface PassWindow {
  status: WarmStatus
  /** Persisted with each live update so a throttled flush never clobbers a
   *  finer-grained step label (e.g. `delta_2`). */
  currentStep: string
  rangeStart: number
  rangeEnd: number
}

/** Live byte bookkeeping for one pass, shared across its disks. */
export interface PassProgress extends PassWindow {
  /** Denominator: changed-extent bytes across ALL disks of the pass. */
  totalBytes: number
  /** Exact bytes from disks already fully applied (corrected per disk). */
  doneBytes: number
  /** Monotonic floor so a conservative estimate never moves the bar backwards. */
  lastPct: number
}

// Apply a disk's changed extents to its target. buildApplyScripts splits the
// dd batch into one or more commands, each bounded so no single command
// exceeds the OS argument-length limit (see MAX_APPLY_CMD_BYTES) — a large
// change set in one command was rejected at exec and surfaced as an opaque
// "EOF" (#445). We run the commands in order and stop on the first failure,
// so the original abort-on-first-error (`set -e`) semantics hold across the
// split. `label` distinguishes the delta/full path from the checksum path.
export async function applyExtentsWithProgress(a: {
  jobId: string; connectionId: string; nodeIp: string
  nbdDev: string; dev: string; extents: Extent[]; capacityBytes: number
  label: string; diskIndex: number; pass: PassProgress
}): Promise<void> {
  const { jobId, connectionId, nodeIp, nbdDev, dev, extents, capacityBytes, label, diskIndex, pass } = a
  // Live progress: accumulate dd's status=progress counters off the stream —
  // the pass runs one dd per extent, so the raw counter restarts at 0 with
  // every batch and the log read "copying 0.0 GB" for the whole run (#502).
  // The cumulative figure drives the job's progress/bytesTransferred within
  // the pass's window (throttled to one DB write per interval). Also feeds
  // executeSSH's inactivity guard, which resets on every byte — so a moving
  // copy is never cut off and a stalled one fails within APPLY_INACTIVITY_MS
  // instead of hanging to the 12h cap.
  const accumulate = createDdProgressAccumulator()
  let lastFlush = 0
  const onData = (chunk: string): void => {
    const p = accumulate(chunk)
    if (!p) return
    const now = Date.now()
    if (now - lastFlush < PROGRESS_LOG_INTERVAL_MS) return
    lastFlush = now
    const passBytes = Math.min(pass.doneBytes + p.bytes, pass.totalBytes)
    const pct = Math.max(pass.lastPct, scaleWarmProgress(pass.rangeStart, pass.rangeEnd, passBytes, pass.totalBytes))
    pass.lastPct = pct
    // Progress first, then the log line — appendLog stamps each entry with
    // the job's current progress, which is why the lines used to read 0 (#502).
    void (async () => {
      await updateJobLive(jobId, pass.status, { currentStep: pass.currentStep, currentDisk: diskIndex, progress: pct, bytesTransferred: BigInt(passBytes), transferSpeed: `${(p.bytesPerSec / 1048576).toFixed(0)} MB/s` })
      await appendLog(jobId, `Disk ${diskIndex}: copying ${(passBytes / 1073741824).toFixed(1)} GB at ${(p.bytesPerSec / 1048576).toFixed(0)} MB/s`)
    })().catch(() => {})
  }
  for (const script of buildApplyScripts(nbdDev, dev, extents, capacityBytes)) {
    const res = await executeSSH(connectionId, nodeIp, script, APPLY_TIMEOUT_MS, { inactivityMs: APPLY_INACTIVITY_MS, onData })
    if (!res.success) throw new Error(`${label} on disk ${diskIndex}: ${res.error || res.output}`)
  }
}
