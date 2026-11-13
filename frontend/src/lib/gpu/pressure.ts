// GPU pressure (#672): what the readings mean against the operator's
// thresholds, and the shapes the load charts draw. Pure, so the page and the
// tests share it.
import type { VisibleGpuReading, VisibleSeries } from './metricsShared'

export type GpuThresholds = { util_pct: number; memory_pct: number; temp_c: number }

export type GpuPressure = {
  saturated: boolean
  memoryPressure: boolean
  hot: boolean
  throttled: boolean
}

export const memoryPct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0)

type Reading = Pick<VisibleGpuReading, 'util' | 'mem_used' | 'mem_total' | 'temp' | 'thermal_slow' | 'power_slow'>

export function pressureOf(g: Reading, t: GpuThresholds): GpuPressure {
  return {
    saturated: g.util >= t.util_pct,
    memoryPressure: memoryPct(g.mem_used, g.mem_total) >= t.memory_pct,
    hot: g.temp > 0 && g.temp >= t.temp_c,
    throttled: g.thermal_slow || g.power_slow,
  }
}

export type FleetLoad = {
  gpus: number
  avgUtil: number
  memoryPct: number
  memoryUsed: number
  memoryTotal: number
  power: number
  saturated: number
  memoryPressure: number
  hot: number
  throttled: number
  /**
   * GPUs hot or slowed down by heat, each counted once. A GPU held at its
   * power limit is not: an AI load runs there all the time (no alert either).
   */
  hotOrThrottled: number
}

/** The fleet as one figure per question: how busy, how full, how many under pressure. */
export function fleetLoad(gpus: Reading[], t: GpuThresholds): FleetLoad {
  const out: FleetLoad = { gpus: gpus.length, avgUtil: 0, memoryPct: 0, memoryUsed: 0, memoryTotal: 0, power: 0, saturated: 0, memoryPressure: 0, hot: 0, throttled: 0, hotOrThrottled: 0 }
  if (!gpus.length) return out
  let util = 0
  for (const g of gpus) {
    util += g.util
    out.memoryUsed += g.mem_used
    out.memoryTotal += g.mem_total
    out.power += (g as { power?: number }).power ?? 0
    const p = pressureOf(g, t)
    if (p.saturated) out.saturated++
    if (p.memoryPressure) out.memoryPressure++
    if (p.hot) out.hot++
    if (p.throttled) out.throttled++
    if (p.hot || (g as { thermal_slow?: boolean }).thermal_slow) out.hotOrThrottled++
  }
  out.avgUtil = util / gpus.length
  out.memoryPct = memoryPct(out.memoryUsed, out.memoryTotal)
  return out
}

export type GpuMetric = 'util' | 'memory' | 'temp' | 'power'

type Point = VisibleSeries['points'][number]

export const metricValue = (p: Point, m: GpuMetric): number => {
  switch (m) {
    case 'util':
      return p.util
    case 'memory':
      return memoryPct(p.mem_used, p.mem_total)
    case 'temp':
      return p.temp_max
    case 'power':
      return p.power
  }
}

/** The fixed categorical order (dataviz reference palette), light and dark steps. */
export const SERIES_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}
export const OTHER_COLOR = '#8a8a86'

/** At most this many GPUs get a line; the rest fold into "Others". */
export const MAX_LINES = 8

export type ChartSeries = { key: string; label: string; colorIndex: number | null }

export type ChartData = { rows: Array<Record<string, number | null>>; series: ChartSeries[] }

/** "vm #id", or "node · model" for a host reading; the cluster is added when several are shown. */
export const seriesLabel = (s: Pick<VisibleSeries, 'vmName' | 'vmid' | 'node' | 'deviceName'> & { connectionName?: string }, withCluster = false) => {
  const base = s.vmName ? `${s.vmName}${s.vmid ? ` #${s.vmid}` : ''}` : `${s.node} · ${s.deviceName ?? 'GPU'}`
  return withCluster && s.connectionName ? `${base} (${s.connectionName})` : base
}

/** Several clusters among these series: their labels then name the cluster. */
export const spansClusters = (series: Array<{ connectionId?: string; connection_id?: string }>) =>
  new Set(series.map(s => s.connectionId ?? s.connection_id)).size > 1

/**
 * One row per bucket, one column per GPU. A GPU keeps its colour whatever the
 * range (its rank in the target order, never its rank by load). Past
 * MAX_LINES GPUs, the most loaded MAX_LINES - 1 keep their line and the others
 * are averaged into one grey "Others" line.
 */
export function chartData(series: VisibleSeries[], metric: GpuMetric, from: number, to: number, step: number, othersLabel: string): ChartData {
  const ordered = [...series].sort((a, b) => `${a.connectionId}|${a.target}`.localeCompare(`${b.connectionId}|${b.target}`))
  const colorOf = new Map(ordered.map((s, i) => [s.target + s.connectionId, i % SERIES_COLORS.light.length]))

  let shown = ordered
  let folded: VisibleSeries[] = []
  if (ordered.length > MAX_LINES) {
    const mean = (s: VisibleSeries) => s.points.reduce((sum, p) => sum + metricValue(p, metric), 0) / Math.max(1, s.points.length)
    const byLoad = [...ordered].sort((a, b) => mean(b) - mean(a))
    const keep = new Set(byLoad.slice(0, MAX_LINES - 1))
    shown = ordered.filter(s => keep.has(s))
    folded = ordered.filter(s => !keep.has(s))
  }

  const keyOf = (s: VisibleSeries) => `s${ordered.indexOf(s)}`
  const index = new Map<number, Record<string, number | null>>()
  for (let t = from; t < to; t += step) index.set(t, { time: t })
  for (const s of shown) {
    for (const p of s.points) {
      const row = index.get(p.time)
      if (row) row[keyOf(s)] = Math.round(metricValue(p, metric) * 10) / 10
    }
  }
  if (folded.length) {
    const sums = new Map<number, { sum: number; n: number }>()
    for (const s of folded) {
      for (const p of s.points) {
        const acc = sums.get(p.time) ?? { sum: 0, n: 0 }
        acc.sum += metricValue(p, metric)
        acc.n++
        sums.set(p.time, acc)
      }
    }
    for (const [time, acc] of sums) {
      const row = index.get(time)
      if (row) row.others = Math.round((acc.sum / acc.n) * 10) / 10
    }
  }

  const withCluster = spansClusters(ordered)
  const out: ChartSeries[] = shown.map(s => ({ key: keyOf(s), label: seriesLabel(s, withCluster), colorIndex: colorOf.get(s.target + s.connectionId) ?? 0 }))
  if (folded.length) out.push({ key: 'others', label: `${othersLabel} (${folded.length})`, colorIndex: null })
  return { rows: [...index.values()], series: out }
}

export type FleetTrendPoint = { time: number; util: number | null; memory: number | null; power: number | null }

/**
 * The fleet over time, one point per bucket: average load, share of GPU memory
 * used and power drawn by every GPU read in that bucket. One series per card,
 * the host's when there is one: a card shared out as vGPUs is also read from
 * each of its VMs, which would count it twice.
 */
export function fleetTrend(series: VisibleSeries[], from: number, to: number, step: number): FleetTrendPoint[] {
  const perCard = new Map<string, VisibleSeries>()
  const loose: VisibleSeries[] = []
  for (const s of series) {
    if (!s.deviceKey) {
      loose.push(s)
      continue
    }
    const held = perCard.get(s.deviceKey)
    if (!held || (!held.target.startsWith('node:') && s.target.startsWith('node:'))) perCard.set(s.deviceKey, s)
  }
  const kept = [...perCard.values(), ...loose]
  const out: FleetTrendPoint[] = []
  for (let time = from; time < to; time += step) {
    let n = 0
    let util = 0
    let used = 0
    let total = 0
    let power = 0
    for (const s of kept) {
      const p = s.points.find(x => x.time === time)
      if (!p) continue
      n++
      util += p.util
      used += p.mem_used
      total += p.mem_total
      power += p.power
    }
    out.push(n ? { time, util: util / n, memory: memoryPct(used, total), power } : { time, util: null, memory: null, power: null })
  }
  return out
}
