/**
 * Progress of a disk or volume move, read from the PVE task log (roadmap#196).
 *
 * `qmmove` (VM disk move) writes one line per step of the copy:
 *  - online, drive mirror:  "mirror-scsi0: transferred 512.0 MiB of 1.0 GiB (50.00%) in 2s"
 *  - offline, qemu-img:     "transferred 8.0 GiB of 32.0 GiB (25.00%)"
 * `move_volume` (container volume move) carries percentages too. Pure: the
 * task route and the components share it.
 */

export interface MoveProgress {
  /** 0 to 100. */
  percent: number
  doneBytes: number | null
  totalBytes: number | null
  /** Average throughput of the copy so far. */
  bytesPerSec: number | null
  /** Seconds left at that throughput; 0 once everything is copied. */
  etaSec: number | null
}

const MOVE_TASK_TYPES = new Set(['qmmove', 'move_volume', 'vzmove'])

/** Whether a PVE task type is a disk or volume move. */
export function isMoveTaskType(type: string | null | undefined): boolean {
  return !!type && MOVE_TASK_TYPES.has(type)
}

const UNIT_POWER: Record<string, number> = { b: 0, k: 1, m: 2, g: 3, t: 4, p: 5 }

/** Bytes of a rendered size ("512.0" "MiB"). Units are read as binary, as PVE renders them. */
export function parseByteSize(value: string, unit: string): number | null {
  const num = Number.parseFloat(value)
  const m = /^([bkmgtp])(?:i?b)?$/i.exec(unit.trim())
  if (!Number.isFinite(num) || !m) return null

  return num * 1024 ** UNIT_POWER[m[1].toLowerCase()]
}

/** Seconds of "2s", "1m 5s" or "1h 2m 3s"; null otherwise. */
export function parseDurationSec(text: string): number | null {
  const m = /^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s$/.exec(text.trim())
  if (!m) return null

  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3])
}

/** Start time (epoch seconds) of `UPID:node:pid:pstart:starttime:type:id:user:`. */
export function upidStartSec(upid: string): number | null {
  const parts = upid.split(':')
  if (parts[0] !== 'UPID' || !/^[0-9a-f]+$/i.test(parts[4] || '')) return null

  return Number.parseInt(parts[4], 16)
}

/** Whether the log holds the closing line PVE writes when a task ends. */
export function isTaskLogEnd(lines: ReadonlyArray<string>): boolean {
  return lines.some(line => /^TASK (OK|ERROR|WARNINGS)\b/.test(line))
}

const TRANSFER_RE = /transferred\s+(\d+(?:\.\d+)?)\s*([a-z]+)\s+of\s+(\d+(?:\.\d+)?)\s*([a-z]+)\s*\((\d+(?:\.\d+)?)%\)(?:\s+in\s+((?:\d+h\s*)?(?:\d+m\s*)?\d+s))?/i
const PERCENT_RE = /(?<![\d.,])(\d{1,3}(?:\.\d+)?)%/

const clampPercent = (pct: number) => Math.min(100, Math.max(0, pct))

function fromTransferLine(m: RegExpExecArray, elapsedSec?: number): MoveProgress {
  const percent = clampPercent(Number.parseFloat(m[5]))
  const doneBytes = parseByteSize(m[1], m[2])
  const totalBytes = parseByteSize(m[3], m[4])
  if (doneBytes === null || totalBytes === null) {
    return { percent, doneBytes: null, totalBytes: null, bytesPerSec: null, etaSec: null }
  }

  // The mirror says how long it has been copying; a plain copy does not, so
  // the age of the task stands in for it.
  const seconds = (m[6] ? parseDurationSec(m[6]) : null) ?? elapsedSec ?? 0
  const bytesPerSec = seconds > 0 && doneBytes > 0 ? doneBytes / seconds : null
  let etaSec: number | null = null
  if (doneBytes >= totalBytes) etaSec = 0
  else if (bytesPerSec) etaSec = Math.round((totalBytes - doneBytes) / bytesPerSec)

  return { percent, doneBytes, totalBytes, bytesPerSec, etaSec }
}

/**
 * Progress of a move from the lines of its log (any window of it, oldest
 * first): the newest line that reports progress wins. Null when none does.
 */
export function parseMoveProgress(
  lines: ReadonlyArray<string>,
  opts: { elapsedSec?: number } = {},
): MoveProgress | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] || ''
    const transfer = TRANSFER_RE.exec(line)
    if (transfer) return fromTransferLine(transfer, opts.elapsedSec)

    const pct = PERCENT_RE.exec(line)
    if (pct) {
      return { percent: clampPercent(Number.parseFloat(pct[1])), doneBytes: null, totalBytes: null, bytesPerSec: null, etaSec: null }
    }
  }

  return null
}
