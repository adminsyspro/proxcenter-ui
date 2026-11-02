/*
   Per-OSD I/O rates from the cumulative counters of the ceph-exporter (relevé par
   différence). Pure: the hook keeps the previous sample and the buffer, this file
   only computes. A counter that goes down means the OSD restarted: no point, the
   new sample becomes the reference.
*/

/** One reading of the cumulative counters of an OSD (`at` in ms epoch), as the exporter route returns it. */
export interface OsdCountersSample {
  at: number
  op_r: number
  op_w: number
  op_r_out_bytes: number
  op_w_in_bytes: number
}

/** One point of the activity curves: ops per second and bytes per second, `time` in ms epoch. */
export interface OsdIoPoint {
  time: number
  readOps: number
  writeOps: number
  readBytes: number
  writeBytes: number
}

/** Session buffer: the last 5 minutes. */
export const OSD_IO_WINDOW_MS = 5 * 60_000
/** Smallest margin between two readings, whatever the period of the consumer. */
export const OSD_IO_MIN_GAP_MS = 15_000

/** Largest gap still read as one step for a consumer that polls every `periodMs`: twice its period, at least 15 s. */
export function ioMaxGap(periodMs: number): number {
  return Math.max(OSD_IO_MIN_GAP_MS, 2 * periodMs)
}

/** Default margin: the one of the OSD sheet, which polls every 5 s. A slower consumer passes `ioMaxGap(its period)`. */
export const OSD_IO_MAX_GAP_MS = ioMaxGap(5000)

const COUNTERS = ['op_r', 'op_w', 'op_r_out_bytes', 'op_w_in_bytes'] as const

export function isOsdCountersSample(v: unknown): v is OsdCountersSample {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>

  return Number.isFinite(o.at) && COUNTERS.every(k => typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0)
}

/** Rate between two readings, or null (no time elapsed, further apart than `maxGapMs`, or a counter went down = OSD restarted). */
export function ioRate(prev: OsdCountersSample, next: OsdCountersSample, maxGapMs = OSD_IO_MAX_GAP_MS): OsdIoPoint | null {
  const dt = (next.at - prev.at) / 1000

  if (dt <= 0 || next.at - prev.at > maxGapMs) return null
  if (COUNTERS.some(k => next[k] < prev[k])) return null

  return {
    time: next.at,
    readOps: (next.op_r - prev.op_r) / dt,
    writeOps: (next.op_w - prev.op_w) / dt,
    readBytes: (next.op_r_out_bytes - prev.op_r_out_bytes) / dt,
    writeBytes: (next.op_w_in_bytes - prev.op_w_in_bytes) / dt,
  }
}

/** Appends a point and drops what is older than the window (counted from the new point). */
export function pushIoPoint(points: readonly OsdIoPoint[], point: OsdIoPoint, windowMs = OSD_IO_WINDOW_MS): OsdIoPoint[] {
  const floor = point.time - windowMs

  return [...points, point].filter(p => p.time >= floor)
}

/**
 * History points followed by the real-time ones that come after them: a live point is kept only when
 * it is newer than the last stored one, so the two never overlap on the time axis.
 */
export function mergeIoSeries(history: readonly OsdIoPoint[], live: readonly OsdIoPoint[]): OsdIoPoint[] {
  const last = history.at(-1)?.time ?? -Infinity

  return [...history, ...live.filter(p => p.time > last)]
}
