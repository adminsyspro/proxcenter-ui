// Live throughput of a migration follow-up (roadmap#53 part B): the bulk
// dialog and the single-VM progress view chart how fast the batch moves data,
// summed over its running jobs, so an operator who raised the concurrency sees
// whether the extra jobs add bandwidth or only share it.
//
// Rate of a job: the engine's own live rate (`transferSpeed`, "33 MB/s", the
// copy's dd rate) when it publishes one, else derived poll after poll from the
// cumulated `bytesTransferred`. The warm engines write both only every 30 s
// (PROGRESS_LOG_INTERVAL_MS), so the rate of a write stands until the next.

import { bulkJobState } from './bulkJobList'

/** How long the samples are kept: the longest range the chart offers. */
export const THROUGHPUT_WINDOW_MS = 24 * 60 * 60 * 1000
/** Ranges the operator can pick, and the one shown first. */
export const THROUGHPUT_RANGES = { '1m': 60_000, '5m': 5 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 } as const
export type ThroughputRange = keyof typeof THROUGHPUT_RANGES
export const THROUGHPUT_DEFAULT_RANGE: ThroughputRange = '5m'
/** Points drawn at most: a long range is averaged into this many buckets. */
export const THROUGHPUT_MAX_POINTS = 240
/**
 * A counter that did not move for this long is a stalled job. Below it, the
 * job keeps its last rate: the warm engines write the counter every 30 s, not
 * at every 3 s poll, and a 0 between two writes would make the chart saw.
 */
export const THROUGHPUT_STALL_MS = 65_000
/** Two looks closer than this are a re-render, not a new poll. */
const MIN_SAMPLE_GAP_MS = 1000

export const MB = 1024 * 1024

export interface ThroughputJob {
  id: string
  name: string
  status: string
  bytesTransferred?: number | null
  /** The engine's live rate, as it writes it ("33 MB/s", "1.2 GB/s"); null between phases. */
  transferSpeed?: string | null
}

const UNIT: Record<string, number> = { B: 1, KB: 1024, MB, GB: 1024 * MB }

/**
 * Bytes per second from an engine's `transferSpeed`, null when there is none
 * or it is not a copy rate (the thick zeroing of a warm target reads
 * "Zeroing: 120 MB/s": it writes the target, it moves no data).
 */
export function parseTransferSpeed(speed: string | null | undefined): number | null {
  if (!speed || /zero/i.test(speed)) return null
  const m = /([\d.]+)\s*(B|KB|MB|GB)\/s/i.exec(speed)
  if (!m) return null
  const n = Number(m[1]) * UNIT[m[2].toUpperCase()]
  return Number.isFinite(n) && n >= 0 ? n : null
}

export interface ThroughputSample {
  t: number
  /** Bytes per second, all jobs together. */
  total: number
  /** Bytes per second of each job that moved data. */
  byJob: Record<string, number>
}

interface JobBaseline {
  bytes: number
  /** When the counter last changed. */
  at: number
  /** Rate measured at that change, bytes per second. */
  rate: number
}

export interface ThroughputState {
  /** The batch (or the single job) these samples belong to. */
  key: string
  baselines: Record<string, JobBaseline>
  samples: ThroughputSample[]
  lastAt: number | null
}

export function emptyThroughput(key: string): ThroughputState {
  return { key, baselines: {}, samples: [], lastAt: null }
}

/**
 * Adds the look at `jobs` taken at `now`. Only running jobs count; a job seen
 * for the first time sets its baseline and contributes nothing yet, a counter
 * that went back (the job restarted its copy) resets the baseline and never
 * yields a negative rate, a job that finished or got queued again drops out.
 */
export function addThroughputSample(state: ThroughputState, jobs: ThroughputJob[], now: number): ThroughputState {
  if (state.lastAt != null && now - state.lastAt < MIN_SAMPLE_GAP_MS) return state
  const baselines: Record<string, JobBaseline> = {}
  const byJob: Record<string, number> = {}
  let total = 0
  for (const job of jobs) {
    if (bulkJobState(job.status) !== 'active') continue
    const published = parseTransferSpeed(job.transferSpeed)
    const bytes = Number(job.bytesTransferred)
    if (job.bytesTransferred == null || !Number.isFinite(bytes)) {
      if (published && published > 0) { byJob[job.id] = published; total += published }
      continue
    }
    const prev = state.baselines[job.id]
    let next: JobBaseline
    let rate = 0
    if (published !== null) {
      // The engine's own rate wins; the baseline still follows the counter.
      next = !prev || bytes !== prev.bytes ? { bytes, at: now, rate: published } : { ...prev, rate: published }
      rate = published
    } else if (!prev || bytes < prev.bytes) {
      next = { bytes, at: now, rate: 0 }
    } else if (bytes > prev.bytes) {
      // Spread over the time since the counter last moved, which is the
      // real span of the bytes when the engine writes less often than we poll.
      const seconds = (now - prev.at) / 1000
      rate = seconds > 0 ? (bytes - prev.bytes) / seconds : 0
      next = { bytes, at: now, rate }
    } else {
      next = prev
      rate = now - prev.at < THROUGHPUT_STALL_MS ? prev.rate : 0
    }
    baselines[job.id] = next
    if (rate > 0) {
      byJob[job.id] = rate
      total += rate
    }
  }
  const samples = [...state.samples, { t: now, total, byJob }].filter(s => s.t >= now - THROUGHPUT_WINDOW_MS)
  return { key: state.key, baselines, samples, lastAt: now }
}

export interface ThroughputSeries {
  key: string
  name: string
}

export interface ThroughputChart {
  series: ThroughputSeries[]
  /** One row per sample: `t` in ms, then MB/s under each series key and THROUGHPUT_TOTAL_KEY. */
  rows: Array<Record<string, number>>
  /** Bytes per second, at the last sample and at the highest one of the window. */
  currentBps: number
  peakBps: number
}

/** Row key of the batch total, drawn as its own line over the VMs' areas. */
export const THROUGHPUT_TOTAL_KEY = '__total__'

/**
 * What the chart draws over `range`: one area per VM that moved data in that
 * span, running or finished, each at its own rate (not stacked: the axis
 * reads each VM's MB/s), plus the batch total; samples averaged
 * into at most THROUGHPUT_MAX_POINTS buckets on a long range. The figures are
 * the last sample and the peak of the range.
 */
export function throughputChart(state: ThroughputState, jobs: ThroughputJob[], range: ThroughputRange = THROUGHPUT_DEFAULT_RANGE): ThroughputChart {
  const last = state.samples.length > 0 ? state.samples[state.samples.length - 1] : null
  const from = (last?.t ?? 0) - THROUGHPUT_RANGES[range]
  const samples = state.samples.filter(s => s.t >= from)
  const currentBps = last?.total ?? 0
  const peakBps = samples.reduce((m, s) => Math.max(m, s.total), 0)
  const names = new Map(jobs.map(j => [j.id, j.name]))
  // Series in order of first appearance, named after their job.
  const ids: string[] = []
  for (const s of samples) for (const id of Object.keys(s.byJob)) if (s.byJob[id] > 0 && !ids.includes(id)) ids.push(id)
  const series: ThroughputSeries[] = ids.map(id => ({ key: id, name: names.get(id) ?? id }))
  const size = Math.max(1, Math.ceil(samples.length / THROUGHPUT_MAX_POINTS))
  const rows: Array<Record<string, number>> = []
  for (let i = 0; i < samples.length; i += size) {
    const bucket = samples.slice(i, i + size)
    const row: Record<string, number> = { t: Math.round(bucket.reduce((m, s) => m + s.t, 0) / bucket.length) }
    for (const id of ids) row[id] = bucket.reduce((m, s) => m + (s.byJob[id] || 0), 0) / bucket.length / MB
    row[THROUGHPUT_TOTAL_KEY] = bucket.reduce((m, s) => m + s.total, 0) / bucket.length / MB
    rows.push(row)
  }
  return { series, rows, currentBps, peakBps }
}

/** "12.3 MB/s" from bytes per second. */
export function formatMBps(bps: number): string {
  return `${(Math.max(0, bps) / MB).toFixed(1)} MB/s`
}

/** Below this span the time axis shows seconds: minutes alone would repeat. */
export const AXIS_SECONDS_BELOW_MS = 10 * 60 * 1000

/**
 * Time label of the chart's axis in the app's locale (12 or 24 h as the locale
 * writes it), with seconds when the window is short.
 */
export function axisTimeLabel(t: number, spanMs: number, locale?: string): string {
  return new Date(t).toLocaleTimeString(locale, spanMs < AXIS_SECONDS_BELOW_MS
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' })
}

/**
 * Up to `count` ticks spread over [min, max], on whole seconds, and never two
 * with the same label: a short window used to print "09:13 AM" five times.
 */
export function axisTicks(min: number, max: number, locale?: string, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return Number.isFinite(min) ? [min] : []
  const span = max - min
  const out: number[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    const t = Math.round((min + (span * i) / (count - 1)) / 1000) * 1000
    const label = axisTimeLabel(t, span, locale)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(t)
  }
  return out
}
