import type { CephHistory } from '@/lib/orchestrator/client'

import type { CephLive } from './live'
import { osdLatencyMs } from './overview'
import type { CephOsd } from './types'

/*
   Series of the Performance tab. Unlike the undated arrays of overview.ts (sparklines),
   these carry the real time of each sample, so a collection gap shows as a gap on the
   axis. The latency reading of an OSD comes from overview.ts (osdLatencyMs), the one rule.
*/

export interface PerfPoint {
  /** Sample time in ms (Date.now() scale), for both the Live buffer and the history. */
  t: number
  /**
   * Step of the source of this point in ms: the polling period for a Live reading, the bucket of the
   * stored period for a history point. A hole is judged against it; without it, against the median spacing.
   */
  step?: number
  readOps: number
  writeOps: number
  readBytes: number
  writeBytes: number
  recoveryBytes: number
  /** PGs that are not active+clean: total minus clean. */
  pgsUnclean: number
}

/** A chart row: a collection gap is a row whose values are null, so the line breaks there. */
export type PerfRow = { t: number; step?: number } & { [K in Exclude<keyof PerfPoint, 't' | 'step'>]: number | null }

/** Polling period of the Live buffer in ms (LIVE_INTERVAL_MS of the Live hook, a test keeps the two equal). */
export const LIVE_STEP_MS = 5000

/** Bucket used when a stored period carries no usable step. */
const DEFAULT_HISTORY_STEP_MS = 60_000

/** Series of the Live buffer. */
export function seriesFromLive(buffer: CephLive[]): PerfPoint[] {
  return buffer.map(l => ({
    t: l.at,
    step: LIVE_STEP_MS,
    readOps: l.io.readOps,
    writeOps: l.io.writeOps,
    readBytes: l.io.readBytes,
    writeBytes: l.io.writeBytes,
    recoveryBytes: l.recovery.bytesPerSec,
    pgsUnclean: Math.max(0, l.pg.total - l.pg.clean),
  }))
}

/** Series of a stored period, oldest first. */
export function seriesFromHistory(history: CephHistory): PerfPoint[] {
  const step = Number.isFinite(history.step) && history.step > 0 ? history.step * 1000 : DEFAULT_HISTORY_STEP_MS

  return history.points
    .map(p => ({
      t: p.time * 1000,
      step,
      readOps: p.read_ops,
      writeOps: p.write_ops,
      readBytes: p.read_bytes,
      writeBytes: p.write_bytes,
      recoveryBytes: p.recovering_bytes,
      pgsUnclean: Math.max(0, p.pgs_total - p.pgs_clean),
    }))
    .sort((a, b) => a.t - b.t)
}

const GAP_FACTOR = 2.5

/** Approximate advance of one character of an axis tick (10.5 px tabular figures) and the room kept around the label. */
const TICK_CHAR_PX = 6.6
const TICK_PADDING_PX = 12

/**
 * Width of a value axis: that of the longest formatted tick label (a measure by character count, no DOM),
 * never under `min`. A label wider than its axis is broken on two lines by the chart and cropped.
 */
export function tickAxisWidth(labels: string[], min: number): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0)

  return Math.max(min, Math.ceil(longest * TICK_CHAR_PX + TICK_PADDING_PX))
}

/**
 * Merge of the last hour of history (one point per bucket, `time` = start of the bucket) with the Live
 * buffer (one reading per poll). A history point is kept only where the buffer has no reading inside its
 * bucket [t, t + step): the buffer wins wherever it has data, the history fills only its holes (tab hidden,
 * browser asleep, page just opened). So no minute is drawn twice and the line never goes back and forth
 * between the two sources. Oldest first; each point keeps its own step.
 */
export function mergeHistoryAndLive(history: PerfPoint[], live: PerfPoint[]): PerfPoint[] {
  if (history.length === 0) return live
  if (live.length === 0) return history

  const times = live.map(p => p.t).sort((a, b) => a - b)
  // First live reading at or after `from` (binary search), to test a bucket in O(log n).
  const firstAtOrAfter = (from: number) => {
    let lo = 0
    let hi = times.length

    while (lo < hi) {
      const mid = (lo + hi) >> 1

      if (times[mid] < from) lo = mid + 1
      else hi = mid
    }

    return lo
  }

  const kept = history.filter(p => {
    const i = firstAtOrAfter(p.t)

    return i >= times.length || times[i] >= p.t + (p.step ?? DEFAULT_HISTORY_STEP_MS)
  })

  return [...kept, ...live].sort((a, b) => a.t - b.t)
}

/**
 * Rows for the chart. Where two neighbours are further apart than 2.5 times the step, an empty row is
 * inserted just after the first one: the line stops there instead of crossing the hole with a straight
 * segment. The step is the coarser of the two neighbours (a history point and a Live point are judged by
 * the history bucket), so a mixed series is not cut at the seam, and never under the usual spacing of the
 * series. Points without a step fall back on the median spacing of the series, as before.
 */
export function insertGaps(points: PerfPoint[]): PerfRow[] {
  const stepped = points.some(p => p.step !== undefined)

  if (points.length < (stepped ? 2 : 3)) return points

  const deltas = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)]
  // Floor of the step: the real spacing of the series (lower median), when a slow Ceph read stretches the Live
  // polling beyond its nominal period every reading would otherwise cut the line. Only judged with 3 spacings or more.
  const spacing = deltas.length >= 3 ? deltas[Math.floor((deltas.length - 1) / 2)] : 0
  const limitBetween = (a: PerfPoint, b: PerfPoint) => {
    const step = Math.max(a.step ?? 0, b.step ?? 0)

    return GAP_FACTOR * (step > 0 ? Math.max(step, spacing) : median)
  }
  const rows: PerfRow[] = []

  points.forEach((p, i) => {
    rows.push(p)
    const next = points[i + 1]

    if (next) {
      const limit = limitBetween(p, next)

      if (limit > 0 && next.t - p.t > limit) {
        rows.push({ t: p.t + 1, readOps: null, writeOps: null, readBytes: null, writeBytes: null, recoveryBytes: null, pgsUnclean: null })
      }
    }
  })

  return rows
}

export interface SlowOsd {
  id: number
  avgMs: number
  maxMs: number
}

export const SLOWEST_SHOWN = 8

/**
 * The slowest OSDs. Over a period: `slowest_osds` of the history (mean over the period).
 * In Live: the latencies of the moment from the inventory, up OSDs that report one only
 * (no reading is not 0 ms).
 */
export function slowestOsds(source: { history?: CephHistory | null; osds?: CephOsd[] }, n = SLOWEST_SHOWN): SlowOsd[] {
  if (source.history) {
    return source.history.slowest_osds
      .filter(o => Number.isFinite(o.avg_ms))
      .map(o => ({ id: o.osd_id, avgMs: o.avg_ms, maxMs: Number.isFinite(o.max_ms) ? o.max_ms : o.avg_ms }))
      .sort((a, b) => b.avgMs - a.avgMs || a.id - b.id)
      .slice(0, n)
  }

  return (source.osds ?? [])
    .filter(o => o.up)
    .flatMap(o => {
      const ms = osdLatencyMs(o)

      return ms === null ? [] : [{ id: o.id, avgMs: ms, maxMs: ms }]
    })
    .sort((a, b) => b.avgMs - a.avgMs || a.id - b.id)
    .slice(0, n)
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/**
 * Round axis: four equal intervals from zero, each a clean figure (a short multiple of a power of ten
 * of the display unit), the last tick at or above the data maximum. `divisor` is the display unit
 * (1024 ** 2 for MiB); `integer` keeps the ticks whole (counts).
 */
export function niceAxis(max: number, divisor = 1, integer = false): { max: number; ticks: number[] } {
  const top = Number.isFinite(max) && max > 0 ? max / divisor : 0
  const raw = Math.max(top / 4, integer ? 1 : 0.25)
  const power = 10 ** Math.floor(Math.log10(raw))
  let step = (STEPS.find(s => s * power >= raw - 1e-9) ?? 10) * power

  if (integer) step = Math.max(1, Math.ceil(step))

  return { max: step * 4 * divisor, ticks: [0, 1, 2, 3, 4].map(i => step * i * divisor) }
}

/** An OSD is slow from this latency (ms)... */
export const SLOW_OSD_MIN_MS = 10
/** ...and when it is at least this many times the cluster baseline. Both must hold. */
export const SLOW_OSD_FACTOR = 2

/**
 * Baseline of the cluster in Live: the median latency of every up OSD that reports one (not only the
 * displayed ones). The lower middle on an even count, so with two OSDs the slow one cannot drag its own baseline up.
 */
export function slowOsdBaseline(osds: CephOsd[]): number | null {
  const values = osds
    .filter(o => o.up)
    .flatMap(o => {
      const ms = osdLatencyMs(o)

      return ms === null ? [] : [ms]
    })
    .sort((a, b) => a - b)

  return values.length > 0 ? values[Math.floor((values.length - 1) / 2)] : null
}

/** Slow OSD: at least SLOW_OSD_MIN_MS and at least SLOW_OSD_FACTOR times the baseline; never without a baseline. */
export function isSlowOsd(ms: number, baseline: number | null): boolean {
  return baseline !== null && ms >= SLOW_OSD_MIN_MS && ms >= SLOW_OSD_FACTOR * baseline
}
