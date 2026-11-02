import type { CephHistory } from '@/lib/orchestrator/client'

import type { CephLive } from './live'
import type { CephOsd } from './types'

/*
   Pure figures of the overview: pool fill, OSD latency, byte
   rate unit, and the series the tiles draw (from the Live buffer or the history).
*/

/** Fill of a pool as a ratio. Ceph gives a 0..1 fraction; an older release (and the demo) a percentage. */
export function poolFillRatio(percentUsed: number): number {
  if (!Number.isFinite(percentUsed) || percentUsed <= 0) return 0
  const ratio = percentUsed > 1 ? percentUsed / 100 : percentUsed

  return Math.min(1, ratio)
}

type LatencyOsd = Pick<CephOsd, 'id' | 'up' | 'commitLatencyMs' | 'applyLatencyMs'>

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Latency of one OSD, the larger of commit and apply; null when neither was measured. */
export function osdLatencyMs(osd: Pick<CephOsd, 'commitLatencyMs' | 'applyLatencyMs'>): number | null {
  const values = [osd.commitLatencyMs, osd.applyLatencyMs].filter(finite)

  return values.length > 0 ? Math.max(...values) : null
}

/** Mean and max latency of the up OSDs that report one, with the slowest OSD. */
export function osdLatency(osds: LatencyOsd[]): { avg: number; max: number; maxOsd: number } | null {
  const up = osds
    .filter(o => o.up)
    .flatMap(o => {
      const ms = osdLatencyMs(o)

      return ms === null ? [] : [{ id: o.id, ms }]
    })

  if (up.length === 0) return null

  const slowest = up.reduce((a, b) => (b.ms > a.ms ? b : a), up[0])
  const avg = up.reduce((s, o) => s + o.ms, 0) / up.length

  return { avg: Math.round(avg * 100) / 100, max: slowest.ms, maxOsd: slowest.id }
}

const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']

/** Binary unit for a size, chosen from the largest figure shown with it. */
export function binaryUnit(bytes: number): { divisor: number; unit: string } {
  let i = 0

  while (i < SIZE_UNITS.length - 1 && Math.abs(bytes) >= 1024 ** (i + 1)) i++

  return { divisor: 1024 ** i, unit: SIZE_UNITS[i] }
}

/** Binary unit for a byte rate. */
export function byteRateUnit(bytes: number): { divisor: number; unit: string } {
  const { divisor, unit } = binaryUnit(bytes)

  return { divisor, unit: `${unit}/s` }
}

/** The recovery banner appears while data moves back, or while objects are degraded. */
export function recoveryShown(live: CephLive | null): boolean {
  return Boolean(live && (live.recovery.bytesPerSec > 0 || live.recovery.degraded > 0))
}

export interface TileSeries {
  readOps: number[]
  writeOps: number[]
  readBytes: number[]
  writeBytes: number[]
  /** Raw used / raw total, only for the samples that know the total. */
  rawRatio: number[]
  /** Mean OSD latency in ms; empty in Live (the latency comes from the inventory, every 120 s). */
  latencyAvg: number[]
}

/** Series of the Live buffer. */
export function seriesFromBuffer(buffer: CephLive[]): TileSeries {
  return {
    readOps: buffer.map(l => l.io.readOps),
    writeOps: buffer.map(l => l.io.writeOps),
    readBytes: buffer.map(l => l.io.readBytes),
    writeBytes: buffer.map(l => l.io.writeBytes),
    rawRatio: buffer.filter(l => l.raw.total > 0).map(l => l.raw.used / l.raw.total),
    latencyAvg: [],
  }
}

/** Series of a stored period. A bucket without a latency reading is skipped, not drawn as zero. */
export function tileSeriesFromHistory(history: CephHistory): TileSeries {
  const p = history.points

  return {
    readOps: p.map(x => x.read_ops),
    writeOps: p.map(x => x.write_ops),
    readBytes: p.map(x => x.read_bytes),
    writeBytes: p.map(x => x.write_bytes),
    rawRatio: p.filter(x => x.raw_total_bytes > 0).map(x => x.raw_used_bytes / x.raw_total_bytes),
    latencyAvg: p.map(x => x.osd_lat_avg_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
  }
}

export type TrendState = 'live' | 'loading' | 'unavailable' | 'ready'

/** State of the curve zone: Live, loading, unavailable (404, older release, failure) or ready over a stored period. */
export function trendStateOf(range: string, history: unknown, loading: boolean, error: unknown): TrendState {
  if (range === 'live') return 'live'
  if (loading && !history) return 'loading'

  return history && !error ? 'ready' : 'unavailable'
}
