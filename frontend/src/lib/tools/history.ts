/**
 * get_metrics_history: how a host or a guest behaved over a period (#459).
 *
 * The only tool that reads Proxmox history, so its cost is bounded on three
 * sides, measured on the lab (30/10/2026, PVE-PROD, PVE 9):
 * - one `rrddata` GET per call, 0.35 s and 27 KB (hour) to 644 KB (day,
 *   1 440 points) for a host; served by pveproxy, never by the three
 *   pvedaemon workers that protected calls queue on;
 * - at most `MAX_HISTORY_LOOKUPS_PER_QUESTION` per question, shared by every
 *   round through `ctx.usage`;
 * - a `HISTORY_CACHE_TTL_MS` cache per target and period, so asking again,
 *   or for CPU then RAM of the same VM, does not call Proxmox twice.
 *
 * The raw series never reaches the model: it gets a summary (min, average,
 * peak and when, last value), small enough for a 9B model's context and
 * enough to answer "when did it peak". The widget gets the downsampled curve
 * through `CHART_SERIES`, a symbol key JSON serialisation skips.
 */

import { getConnectionById } from '@/lib/connections/getConnection'
import { RRD_ARCHIVES, type RrdTimeframe } from '@/lib/metrics/rrdRange'
import { pveFetch } from '@/lib/proxmox/client'
import { CHART_SERIES, type HistorySeries } from '@/lib/ai/charts'

import { requireNodeView } from './guards'
import {
  argEnum,
  argString,
  resolveGuest,
  resolveNode,
  ToolArgumentError,
  ToolScopeError,
  type CatalogTool,
  type ToolContext,
} from './types'

export const MAX_HISTORY_LOOKUPS_PER_QUESTION = 6

export const HISTORY_CACHE_TTL_MS = 60_000

const HISTORY_CACHE_MAX_ENTRIES = 200

/** Points kept for the curve: enough to read a trend in a chat window. */
export const HISTORY_CHART_POINTS = 60

const METRICS = ['cpu', 'memory', 'network', 'disk_io'] as const
const TIMEFRAMES = ['hour', 'day', 'week', 'month', 'year'] as const

type HistoryMetric = (typeof METRICS)[number]

type RrdRow = Record<string, number | undefined>

type CacheEntry = { at: number; rows: Promise<RrdRow[]> }

const cache = new Map<string, CacheEntry>()

/** Test hook: the cache is module state. */
export function clearHistoryCache() {
  cache.clear()
}

export async function fetchRrd(ctx: ToolContext, connId: string, path: string): Promise<RrdRow[]> {
  // The tenant is part of the key: two tenants never share a reading, even
  // for a connection id they would both resolve.
  const key = `${ctx.tenantId}|${connId}|${path}`
  const hit = cache.get(key)

  if (hit && Date.now() - hit.at < HISTORY_CACHE_TTL_MS) return hit.rows

  // Only a call that reaches Proxmox spends the budget.
  const usage = (ctx.usage ??= { historyLookups: 0 })

  if (usage.historyLookups >= MAX_HISTORY_LOOKUPS_PER_QUESTION) {
    throw new ToolScopeError(
      `History is limited to ${MAX_HISTORY_LOOKUPS_PER_QUESTION} lookups per question and they are spent. Answer with the history already retrieved.`
    )
  }

  usage.historyLookups++

  // The promise is cached, not the rows: CPU and RAM of the same VM asked in
  // one round run in parallel and must share the one Proxmox call.
  const rows = getConnectionById(connId, ctx.tenantId)
    .then(conn => pveFetch<RrdRow[]>(conn, path))
    .then(list => (Array.isArray(list) ? list : []))

  if (cache.size >= HISTORY_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value

    if (oldest !== undefined) cache.delete(oldest)
  }

  cache.set(key, { at: Date.now(), rows })

  // A failed read is not kept: the next question tries Proxmox again.
  rows.catch(() => {
    if (cache.get(key)?.rows === rows) cache.delete(key)
  })

  return rows
}

type Extracted = { unit: HistorySeries['unit']; series: string[]; values: (row: RrdRow) => Array<number | null> }

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const ratioPct = (used: unknown, total: unknown): number | null => {
  const u = n(used)
  const t = n(total)

  return u === null || t === null || t <= 0 ? null : (u / t) * 100
}

const scaled = (v: unknown, factor: number): number | null => {
  const x = n(v)

  return x === null ? null : x * factor
}

/** How each metric reads from a host row and from a guest row. */
function extractor(metric: HistoryMetric, isGuest: boolean): Extracted {
  if (metric === 'cpu') return { unit: '%', series: ['cpu'], values: row => [scaled(row.cpu, 100)] }

  if (metric === 'memory') {
    return {
      unit: '%',
      series: ['memory'],
      values: row => [isGuest ? ratioPct(row.mem, row.maxmem) : ratioPct(row.memused, row.memtotal)],
    }
  }

  // Proxmox reports bytes per second.
  if (metric === 'network') {
    return { unit: 'Mbit/s', series: ['in', 'out'], values: row => [scaled(row.netin, 8e-6), scaled(row.netout, 8e-6)] }
  }

  return { unit: 'MB/s', series: ['read', 'write'], values: row => [scaled(row.diskread, 1e-6), scaled(row.diskwrite, 1e-6)] }
}

const round = (v: number) => (Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10)

function formatInstant(epochSeconds: number, timeZone: string | undefined): string {
  const date = new Date(epochSeconds * 1000)

  try {
    // sv-SE prints "2026-10-30 14:05", unambiguous in any answer language.
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date) + (timeZone ? '' : ' UTC')
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  }
}

type Point = { time: number; values: Array<number | null> }

function summarise(points: Point[], series: string[], timeZone: string | undefined) {
  return Object.fromEntries(
    series.map((name, i) => {
      const readings = points
        .map(p => ({ time: p.time, value: p.values[i] }))
        .filter((r): r is { time: number; value: number } => r.value !== null)

      if (readings.length === 0) return [name, null]

      let peak = readings[0]
      let low = readings[0]
      let sum = 0

      for (const r of readings) {
        if (r.value > peak.value) peak = r
        if (r.value < low.value) low = r
        sum += r.value
      }

      return [
        name,
        {
          average: round(sum / readings.length),
          peak: round(peak.value),
          peakAt: formatInstant(peak.time, timeZone),
          lowest: round(low.value),
          last: round(readings[readings.length - 1].value),
        },
      ]
    })
  )
}

/** Average consecutive points into at most `target` buckets. */
export function downsample(points: Point[], target: number): Point[] {
  if (points.length <= target) return points

  const size = points.length / target
  const out: Point[] = []

  for (let b = 0; b < target; b++) {
    const slice = points.slice(Math.floor(b * size), Math.floor((b + 1) * size))

    if (slice.length === 0) continue

    const width = slice[0].values.length

    out.push({
      time: slice[slice.length - 1].time,
      values: Array.from({ length: width }, (_, i) => {
        const vals = slice.map(p => p.values[i]).filter((v): v is number => v !== null)

        return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null
      }),
    })
  }

  return out
}

export const getMetricsHistoryTool: CatalogTool = {
  name: 'get_metrics_history',
  readOnly: true,
  description:
    'How ONE host or ONE VM/container behaved over a past period: CPU, memory, network or disk I/O history, with average, peak and when the peak happened. Answers "show the CPU of pve1 over the last 24 hours", "graph the RAM of VM db-01 this week", "when did web-01 peak", "network traffic of pve2 today". The answer is drawn as a chart for the user. Pass node for a host OR guest for a VM/container, never both. Example: guest=\'db-01\', metric=\'memory\', timeframe=\'day\'',
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Host name, for a host history.' },
      guest: { type: 'string', description: 'VM or container name or vmid, for a guest history.' },
      cluster: { type: 'string', description: 'Cluster name, only when two clusters have a host of that name.' },
      metric: {
        type: 'string',
        description: 'cpu, memory, network (in and out) or disk_io (read and write, guests only).',
        enum: [...METRICS],
        default: 'cpu',
      },
      timeframe: {
        type: 'string',
        description: 'The period, ending now: hour, day (24 hours), week, month or year.',
        enum: [...TIMEFRAMES],
        default: 'day',
      },
    },
  },
  async execute(args, ctx) {
    const metric = argEnum(args, 'metric', METRICS, 'cpu')
    const timeframe = argEnum(args, 'timeframe', TIMEFRAMES, 'day') as RrdTimeframe
    const nodeRef = argString(args, 'node')
    const guestRef = argString(args, 'guest')

    if (nodeRef && guestRef) throw new ToolArgumentError('Pass node OR guest, not both.')
    if (!nodeRef && !guestRef) throw new ToolArgumentError('Pass node (a host name) or guest (a VM or container).')

    // Security gate: the target must be in the RBAC- and vDC-filtered
    // snapshot before any Proxmox call, and the path is built only from what
    // the snapshot holds, never from the model's text.
    let connId: string
    let path: string
    let target: string
    let cluster: string

    if (guestRef) {
      const guest = resolveGuest(ctx, guestRef)

      connId = guest.connId
      cluster = guest.cluster
      target = guest.name
      path = `/nodes/${encodeURIComponent(guest.node)}/${guest.kind}/${encodeURIComponent(guest.vmid)}/rrddata`
    } else {
      if (metric === 'disk_io') throw new ToolArgumentError('disk_io history exists for guests only. For a host use cpu, memory or network.')

      const { connection, node } = resolveNode(ctx, nodeRef, argString(args, 'cluster'))

      // The RRD route asks node.view on the host (rbac/rrdScope).
      await requireNodeView(connection.id, node.name)

      connId = connection.id
      cluster = connection.name
      target = node.name
      path = `/nodes/${encodeURIComponent(node.name)}/rrddata`
    }

    const rows = await fetchRrd(ctx, connId, `${path}?timeframe=${timeframe}&cf=AVERAGE`)

    // A PVE 9 archive can run past the period asked for: keep the period.
    const depth = RRD_ARCHIVES.find(a => a.timeframe === timeframe)?.depthSeconds ?? 86_400
    const since = Date.now() / 1000 - depth
    const { unit, series, values } = extractor(metric, Boolean(guestRef))

    const points: Point[] = rows
      .filter(row => (n(row.time) ?? 0) >= since)
      .map(row => ({ time: Number(row.time), values: values(row) }))
      .filter(p => p.values.some(v => v !== null))

    const result: Record<string | symbol, unknown> = {
      target,
      targetType: guestRef ? 'guest' : 'host',
      cluster,
      metric,
      unit,
      timeframe,
      points: points.length,
      summary: points.length ? summarise(points, series, ctx.timeZone) : null,
      ...(points.length ? {} : { note: 'Proxmox returned no reading for this period (stopped guest or new host).' }),
    }

    if (points.length >= 2) {
      result[CHART_SERIES] = {
        target,
        metric,
        timeframe,
        unit,
        series,
        points: downsample(points, HISTORY_CHART_POINTS).map(p => ({
          time: p.time,
          values: p.values.map(v => (v === null ? 0 : round(v))),
        })),
      } satisfies HistorySeries
    }

    return result
  },
}
