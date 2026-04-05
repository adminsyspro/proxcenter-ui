/**
 * Progress parsers for virt-v2v and pv (pipe viewer) output.
 *
 * virt-v2v with --machine-readable emits lines like:
 *   [  45.5%] Copying disk 1/2
 *
 * pv emits lines like:
 *   1.23GiB 0:01:30 [ 120MiB/s] [========>               ] 45% ETA 0:01:50
 */

export interface V2vProgress {
  percent: number
  currentDisk: number
  totalDisks: number
  step: string
}

export interface PvProgress {
  percent: number
  transferred: string
  speed: string
  eta: string
}

const V2V_PROGRESS_RE = /\[\s*([\d.]+)%\]\s*(.+)/
const V2V_DISK_RE = /Copying disk (\d+)\/(\d+)/

/**
 * Parse a single virt-v2v stderr line into structured progress.
 * Returns null for lines that don't match the progress pattern.
 */
export function parseV2vLine(line: string): V2vProgress | null {
  const match = line.match(V2V_PROGRESS_RE)

  if (!match) return null

  const percent = parseFloat(match[1])
  const step = match[2].trim()

  let currentDisk = 1
  let totalDisks = 1

  const diskMatch = step.match(V2V_DISK_RE)

  if (diskMatch) {
    currentDisk = parseInt(diskMatch[1], 10)
    totalDisks = parseInt(diskMatch[2], 10)
  }

  return { percent, currentDisk, totalDisks, step }
}

/**
 * Calculate overall progress weighted across all disks.
 * Each disk gets equal weight (100 / totalDisks).
 *
 * Example: disk 2/3 at 50%
 *   completed disks: 1 * (100/3) = 33.3
 *   current disk:    0.5 * (100/3) = 16.7
 *   total: 50.0%
 */
export function calculateOverallProgress(v2v: V2vProgress): number {
  const weightPerDisk = 100 / v2v.totalDisks
  const completedDisks = v2v.currentDisk - 1
  const overall = completedDisks * weightPerDisk + (v2v.percent / 100) * weightPerDisk

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
