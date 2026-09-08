import { formatLatency } from '@/lib/metrics/latency'
import type { DiskLatencySeriesPoint } from '@/lib/orchestrator/client'

/**
 * Joins the orchestrator's disk latency history onto a Proxmox RRD series so
 * both draw on the same chart (#881).
 *
 * The RRD points carry `t` in milliseconds and sit on multiples of their
 * resolution (60 s for an hour, 30 min for a day…). The orchestrator buckets
 * its samples on multiples of the requested step since the epoch too, so the
 * join is a plain lookup by bucket start once the step matches.
 */

export const LATENCY_KEY_PREFIX = 'lat_'

export function latencyKey(disk: string): string {
  return `${LATENCY_KEY_PREFIX}${disk}`
}

/** The disk behind a chart data key, or null for the bandwidth keys. */
export function diskFromLatencyKey(key: string): string | null {
  return key.startsWith(LATENCY_KEY_PREFIX) ? key.slice(LATENCY_KEY_PREFIX.length) : null
}

/** Median gap between consecutive points, rounded to whole minutes, at least one minute. */
export function inferStepSeconds(series: ReadonlyArray<{ t: number }>): number {
  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const gap = Math.round((series[i].t - series[i - 1].t) / 1000)
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return 60
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]

  return Math.max(60, Math.round(median / 60) * 60)
}

/** Bucket-aligned bounds covering the whole series, in Unix seconds; null for an empty series. */
export function seriesBounds(series: ReadonlyArray<{ t: number }>, stepSec: number): { fromSec: number; toSec: number } | null {
  if (series.length === 0) return null
  const first = Math.floor(series[0].t / 1000 / stepSec) * stepSec
  const last = Math.floor(series[series.length - 1].t / 1000 / stepSec) * stepSec

  return { fromSec: first, toSec: last + stepSec }
}

/**
 * Label and value of one Disk I/O tooltip row: the bandwidth areas keep their
 * Read/Write wording and formatter, a latency line reads "<disk> · <label>" in
 * milliseconds.
 */
export function diskIoTooltipRow(
  dataKey: string,
  value: number,
  formatBps: (bps: number) => string,
  latencyLabel: string,
): { label: string; value: string } {
  const disk = diskFromLatencyKey(dataKey)
  if (disk) return { label: `${disk} · ${latencyLabel}`, value: formatLatency(value) }

  return { label: dataKey === 'diskReadBps' ? 'Read' : 'Write', value: formatBps(value) }
}

export type LatencyKeyed = Record<string, number | undefined>

export interface MergedLatencySeries<T> {
  data: Array<T & LatencyKeyed>
  /** Disks that saw at least one operation over the range, sorted; the chart draws one line each. */
  disks: string[]
}

export function mergeLatencySeries<T extends { t: number }>(
  series: ReadonlyArray<T>,
  points: ReadonlyArray<DiskLatencySeriesPoint>,
  stepSec: number,
): MergedLatencySeries<T> {
  const byBucket = new Map<number, Map<string, number>>()
  const active = new Set<string>()

  for (const p of points) {
    if (!p?.disk || typeof p.time !== 'number') continue
    const bucket = Math.floor(p.time / stepSec) * stepSec
    let disks = byBucket.get(bucket)
    if (!disks) {
      disks = new Map()
      byBucket.set(bucket, disks)
    }
    disks.set(p.disk, p.latency_ms)
    if ((p.read_ops ?? 0) + (p.write_ops ?? 0) > 0) active.add(p.disk)
  }

  const disks = [...active].sort()
  if (disks.length === 0) return { data: series.map(pt => ({ ...pt })), disks }

  const data = series.map(pt => {
    const bucket = byBucket.get(Math.floor(pt.t / 1000 / stepSec) * stepSec)
    const extra: LatencyKeyed = {}
    for (const disk of disks) extra[latencyKey(disk)] = bucket?.get(disk)

    return { ...pt, ...extra }
  })

  return { data, disks }
}
