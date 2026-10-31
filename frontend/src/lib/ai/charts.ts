/**
 * Charts drawn under an assistant answer (#459).
 *
 * The figures come from what the read-only tools returned, never from the
 * model: a 9B model asked to write chart data mangles the JSON or invents the
 * values. Each chart is derived here from one tool result, travels to the
 * browser beside the trace, and the widget draws it.
 *
 * The tools read the inventory snapshot already in memory, so a chart costs
 * no Proxmox call.
 *
 * Pure module, shared by the routes and the widget: no Next or React import
 * belongs here.
 */

export type AiChartKind = 'host-usage' | 'guest-ranking' | 'storage-usage' | 'history'

export type AiChartUnit = '%' | 'GB' | 'vCPU' | 'Mbit/s' | 'MB/s'

export type AiChartRow = {
  label: string
  /** Where the row lives (cluster, host), shown in the tooltip. */
  detail?: string
  /** One value per series, in the order of `series`. */
  values: number[]
  /** Epoch seconds of a history point; its label is then empty. */
  time?: number
}

export type AiChart = {
  kind: AiChartKind
  /** The ranked metric of a guest ranking (`vcpus`, `memory_usage`, ...). */
  metric?: string
  unit: AiChartUnit
  /** Series names, translated by the widget: `cpu`, `memory`, `used`, `in`, `read`, or the metric. */
  series: string[]
  rows: AiChartRow[]
  /** History only: the host or guest name, and the period. */
  target?: string
  timeframe?: string
}

/**
 * Where a tool puts the series it wants drawn but not read by the model: a
 * symbol key, which `JSON.stringify` skips when the result is handed over.
 */
export const CHART_SERIES = Symbol('chartSeries')

export type HistorySeries = {
  target: string
  metric: string
  timeframe: string
  unit: AiChartUnit
  series: string[]
  points: Array<{ time: number; values: number[] }>
}

/** More bars than this no longer reads as a chart in the chat window. */
export const MAX_CHART_ROWS = 12

/** Points of one history curve, see `HISTORY_CHART_POINTS` in the tool. */
export const MAX_HISTORY_POINTS = 60

/** Charts kept under one answer. */
export const MAX_CHARTS = 3

const KINDS: readonly AiChartKind[] = ['host-usage', 'guest-ranking', 'storage-usage', 'history']
const UNITS: readonly AiChartUnit[] = ['%', 'GB', 'vCPU', 'Mbit/s', 'MB/s']
const TIMEFRAMES = ['hour', 'day', 'week', 'month', 'year']

/** rank_guest_hardware metric → the ranking entry field holding its value. */
const GUEST_METRIC_FIELDS: Record<string, string> = {
  vcpus: 'vcpus',
  memory: 'memoryGb',
  disk: 'diskGb',
  cpu_usage: 'cpuUsagePct',
  memory_usage: 'memoryUsagePct',
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const detailOf = (...parts: unknown[]): string | undefined => {
  const kept = parts.map(text).filter((p): p is string => Boolean(p))

  return kept.length ? kept.join(' · ') : undefined
}

/** A single bar says nothing a sentence does not. */
const worthDrawing = (rows: AiChartRow[]) => rows.length >= 2

function hostUsage(value: Record<string, any>): AiChart | null {
  if (!Array.isArray(value.hosts)) return null

  const rows: AiChartRow[] = []

  for (const host of value.hosts) {
    const name = isRecord(host) ? text(host.name) : undefined
    const cpu = isRecord(host) ? finite(host.cpuPct) : null
    const memory = isRecord(host) ? finite(host.memoryPct) : null

    if (!name || cpu === null || memory === null) continue
    rows.push({ label: name, detail: detailOf(host.cluster), values: [cpu, memory] })
  }

  const kept = rows.slice(0, MAX_CHART_ROWS)

  return worthDrawing(kept) ? { kind: 'host-usage', unit: '%', series: ['cpu', 'memory'], rows: kept } : null
}

function guestRanking(value: Record<string, any>): AiChart | null {
  const metric = text(value.metric)
  const field = metric ? GUEST_METRIC_FIELDS[metric] : undefined
  const unit = UNITS.find(u => u === value.unit)

  if (!metric || !field || !unit || !Array.isArray(value.ranking)) return null

  const rows: AiChartRow[] = []

  for (const entry of value.ranking) {
    const name = isRecord(entry) ? text(entry.name) : undefined
    const metricValue = isRecord(entry) ? finite(entry[field]) : null

    if (!name || metricValue === null) continue
    rows.push({ label: name, detail: detailOf(entry.node, entry.cluster), values: [metricValue] })
  }

  const kept = rows.slice(0, MAX_CHART_ROWS)

  return worthDrawing(kept) ? { kind: 'guest-ranking', metric, unit, series: [metric], rows: kept } : null
}

function storageUsage(value: Record<string, any>): AiChart | null {
  if (!Array.isArray(value.ranking)) return null

  const rows: AiChartRow[] = []

  for (const pool of value.ranking) {
    const name = isRecord(pool) ? text(pool.name) : undefined
    const used = isRecord(pool) ? finite(pool.usedPct) : null

    if (!name || used === null) continue
    // Local pools share their name across hosts (five "ZFS-Pool" bars say
    // nothing): a pool owned by one host is labelled with it.
    const host = text(pool.host)

    rows.push({ label: host ? `${name} (${host})` : name, detail: detailOf(pool.cluster), values: [used] })
  }

  const kept = rows.slice(0, MAX_CHART_ROWS)

  return worthDrawing(kept) ? { kind: 'storage-usage', unit: '%', series: ['used'], rows: kept } : null
}

function history(value: object): AiChart | null {
  const data = (value as Record<symbol, HistorySeries | undefined>)[CHART_SERIES]

  if (!data || !Array.isArray(data.points) || !UNITS.includes(data.unit)) return null

  const rows: AiChartRow[] = data.points
    .slice(-MAX_HISTORY_POINTS)
    .filter(p => isNumber(p?.time) && Array.isArray(p.values) && p.values.length === data.series.length && p.values.every(isNumber))
    .map(p => ({ label: '', time: p.time, values: p.values }))

  return worthDrawing(rows)
    ? {
        kind: 'history',
        metric: data.metric,
        unit: data.unit,
        series: data.series,
        target: data.target,
        timeframe: data.timeframe,
        rows,
      }
    : null
}

/** The chart a tool result supports, or null when it has nothing to plot. */
export function chartFromToolResult(name: string, value: unknown): AiChart | null {
  if (!isRecord(value)) return null
  // Any tool may attach a curve; these two do.
  if (name === 'get_metrics_history' || name === 'forecast_capacity') return history(value)
  if (name === 'list_hosts') return hostUsage(value)
  if (name === 'rank_guest_hardware') return guestRanking(value)
  if (name === 'rank_storage') return storageUsage(value)

  return null
}

const chartKey = (chart: AiChart) => `${chart.kind}:${chart.metric ?? ''}:${chart.target ?? ''}:${chart.timeframe ?? ''}`

/**
 * The charts of one answer: the latest result per view (a model that asked
 * twice narrowed its query the second time), in the order they first came.
 */
export function collectCharts(trace: ReadonlyArray<{ chart?: AiChart }>): AiChart[] {
  const latest = new Map<string, AiChart>()

  for (const entry of trace) {
    if (entry.chart) latest.set(chartKey(entry.chart), entry.chart)
  }

  return [...latest.values()].slice(0, MAX_CHARTS)
}

/** A chart read back from the stream, or null when it is not one. */
export function sanitizeChart(raw: unknown): AiChart | null {
  if (!isRecord(raw)) return null

  const kind = KINDS.find(k => k === raw.kind)
  const unit = UNITS.find(u => u === raw.unit)
  const series = Array.isArray(raw.series) ? raw.series.map(text) : []

  if (!kind || !unit || series.length === 0 || series.length > 2 || series.some(s => !s)) return null
  if (!Array.isArray(raw.rows)) return null

  const isHistory = kind === 'history'
  const timeframe = isHistory ? TIMEFRAMES.find(tf => tf === raw.timeframe) : undefined

  if (isHistory && (!timeframe || !text(raw.target))) return null

  const rows: AiChartRow[] = []

  for (const row of raw.rows.slice(0, isHistory ? MAX_HISTORY_POINTS : MAX_CHART_ROWS)) {
    if (!isRecord(row)) return null

    const label = text(row.label)
    const values = Array.isArray(row.values) ? row.values : []

    // A history point is placed by its time, a bar by its label.
    if (isHistory ? !isNumber(row.time) : !label) return null
    if (values.length !== series.length || !values.every(isNumber)) return null

    rows.push({
      label: label ?? '',
      ...(text(row.detail) ? { detail: text(row.detail) } : {}),
      values,
      ...(isHistory ? { time: row.time } : {}),
    })
  }

  return {
    kind,
    ...(text(raw.metric) ? { metric: text(raw.metric) } : {}),
    unit,
    series: series as string[],
    rows,
    ...(isHistory ? { target: text(raw.target), timeframe } : {}),
  }
}
