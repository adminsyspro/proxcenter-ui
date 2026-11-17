// Host load and memory over the last 24 hours, kept in the memory of this
// frontend process: sampled every 30 seconds whether or not anybody watches
// the Platform status tab, lost when the process restarts, and local to each
// replica in a high-availability install. No table, on purpose.

import { readHost } from './sysinfo'
import type { HostHistory, HostHistoryRange, HostInfo, HostSample } from './types'

export const SAMPLE_INTERVAL_MS = 30_000
const RETENTION_MS = 24 * 60 * 60 * 1000
const CAPACITY = RETENTION_MS / SAMPLE_INTERVAL_MS

export const HISTORY_RANGES: Record<HostHistoryRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': RETENTION_MS
}

// A chart does not need more points than it has pixels to draw them.
const MAX_POINTS = 360

interface HistoryState {
  samples: HostSample[]
  timer: ReturnType<typeof setInterval> | null
}

// On globalThis: Next can load a module more than once (route bundles, dev
// reloads), and every copy must see the one history and the one timer.
const STATE_KEY = Symbol.for('proxcenter.platform.hostHistory')

function state(): HistoryState {
  const holder = globalThis as unknown as Record<symbol, HistoryState | undefined>

  holder[STATE_KEY] ??= { samples: [], timer: null }

  return holder[STATE_KEY]
}

export function recordHostSample(host: HostInfo, nowMs: number): void {
  const { samples } = state()

  samples.push({
    t: nowMs,
    load1: host.load1,
    load5: host.load5,
    load15: host.load15,
    memUsedBytes: Math.max(0, host.memTotalBytes - host.memAvailableBytes)
  })
  if (samples.length > CAPACITY) samples.splice(0, samples.length - CAPACITY)
}

async function sampleOnce(read: () => Promise<HostInfo | null>): Promise<void> {
  try {
    const host = await read()

    if (host) recordHostSample(host, Date.now())
  } catch {
    // A missed sample is a gap in a chart, never a reason to stop sampling.
  }
}

/**
 * Starts the sampler once per process; later calls do nothing. The timer is
 * unref'd so it never keeps the process alive on its own.
 */
export function startHostHistorySampler(read: () => Promise<HostInfo | null> = readHost): void {
  const s = state()

  if (s.timer) return
  void sampleOnce(read)
  s.timer = setInterval(() => void sampleOnce(read), SAMPLE_INTERVAL_MS)
  s.timer.unref?.()
}

/** Stops the sampler and forgets the history; for tests. */
export function resetHostHistory(): void {
  const s = state()

  if (s.timer) clearInterval(s.timer)
  s.timer = null
  s.samples = []
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * The samples of the last `range`, averaged into buckets so the answer never
 * carries more than MAX_POINTS points.
 */
export function hostHistory(range: HostHistoryRange, nowMs: number, host: HostInfo | null): HostHistory {
  const span = HISTORY_RANGES[range]
  const bucketMs = Math.max(SAMPLE_INTERVAL_MS, Math.ceil(span / MAX_POINTS / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS)
  const recent = state().samples.filter(sample => sample.t >= nowMs - span)
  const buckets = new Map<number, HostSample[]>()

  for (const sample of recent) {
    const key = Math.floor(sample.t / bucketMs) * bucketMs
    const bucket = buckets.get(key)

    if (bucket) bucket.push(sample)
    else buckets.set(key, [sample])
  }

  const samples = [...buckets.entries()].map(([t, group]) => ({
    t,
    load1: mean(group.map(s => s.load1)),
    load5: mean(group.map(s => s.load5)),
    load15: mean(group.map(s => s.load15)),
    memUsedBytes: mean(group.map(s => s.memUsedBytes))
  }))

  return {
    range,
    from: nowMs - span,
    to: nowMs,
    intervalSeconds: bucketMs / 1000,
    cpus: host?.cpus ?? 0,
    memTotalBytes: host?.memTotalBytes ?? 0,
    samples
  }
}
