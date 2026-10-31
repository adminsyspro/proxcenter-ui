/**
 * Capacity planning (#459): when will a storage or a host's RAM be full, and
 * does a guest fit on another host.
 *
 * The forecast is a least-squares line through a month of Proxmox history,
 * read with the history tool's reader, so it shares its cache and its
 * per-question budget. The simulation is pure arithmetic on the snapshot.
 */

import { CHART_SERIES, type HistorySeries } from '@/lib/ai/charts'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

import { resolveStorageCaller, storageVisibilityFilter } from '@/lib/storage/storageVisibility'

import { HOST_RAM_RESERVE_PCT } from './capacity'
import { requireNodeView } from './guards'
import { downsample, fetchRrd, HISTORY_CHART_POINTS } from './history'
import {
  argNumber,
  argString,
  resolveConnection,
  resolveGuest,
  resolveNode,
  syncExecute,
  ToolArgumentError,
  ToolScopeError,
  type CatalogTool,
  type ToolContext,
} from './types'

/** A trend is read over at least this much history, or not at all. */
const MIN_HISTORY_DAYS = 3

const STORAGE_LIST_TTL_MS = 60_000

const storageLists = new Map<string, { at: number; rows: Promise<any[]> }>()

/** Test hook: the cache is module state. */
export function clearForecastCache() {
  storageLists.clear()
}

function storageRows(ctx: ToolContext, connId: string): Promise<any[]> {
  const key = `${ctx.tenantId}|${connId}`
  const hit = storageLists.get(key)

  if (hit && Date.now() - hit.at < STORAGE_LIST_TTL_MS) return hit.rows

  const rows = getConnectionById(connId, ctx.tenantId)
    .then(conn => pveFetch<any[]>(conn, '/cluster/resources?type=storage'))
    .then(list => (Array.isArray(list) ? list : []))

  storageLists.set(key, { at: Date.now(), rows })
  rows.catch(() => {
    if (storageLists.get(key)?.rows === rows) storageLists.delete(key)
  })

  return rows
}

/** Least squares: slope in percentage points per day, and the fit's last value. */
export function linearTrend(points: Array<{ time: number; value: number }>) {
  const n = points.length
  const meanT = points.reduce((s, p) => s + p.time, 0) / n
  const meanV = points.reduce((s, p) => s + p.value, 0) / n
  let num = 0
  let den = 0

  for (const p of points) {
    num += (p.time - meanT) * (p.value - meanV)
    den += (p.time - meanT) ** 2
  }

  const slopePerSecond = den === 0 ? 0 : num / den
  const last = points[n - 1]

  return { slopePerDay: slopePerSecond * 86_400, fittedNow: meanV + slopePerSecond * (last.time - meanT) }
}

const r1 = (v: number) => Math.round(v * 10) / 10

function dateIn(days: number, timeZone: string | undefined) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(Date.now() + days * 86_400_000)
    )
  } catch {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  }
}

/* ------------------------------------------------------------------ */
/* forecast_capacity                                                  */
/* ------------------------------------------------------------------ */

export const forecastCapacityTool: CatalogTool = {
  name: 'forecast_capacity',
  readOnly: true,
  description:
    'Forecast from the last month of history: how fast a storage or a host\'s RAM is filling, and on which date it would reach 90 % and 100 % at that pace. Answers "when will ZFS-Pool on pve1 be full?", "how fast is my Ceph pool growing?", "will pve2 run out of RAM?". The month is drawn as a chart. Pass storage (with node for a local storage) OR node alone for its RAM. Example: storage=\'ZFS-Pool\', node=\'pve1\' or node=\'pve2\'',
  parameters: {
    type: 'object',
    properties: {
      storage: { type: 'string', description: 'Storage name, for a storage forecast.' },
      node: { type: 'string', description: 'Host name: the host of a local storage, or the host whose RAM to forecast.' },
      cluster: { type: 'string', description: 'Cluster name, only when the name exists in two clusters.' },
    },
  },
  async execute(args, ctx) {
    const storageRef = argString(args, 'storage')
    const nodeRef = argString(args, 'node')
    const clusterRef = argString(args, 'cluster')

    if (!storageRef && !nodeRef) throw new ToolArgumentError('Pass storage (and node for a local storage) or node for its RAM.')

    let connId: string
    let path: string
    let target: string
    let usedOf: (row: Record<string, number | undefined>) => number | null

    if (storageRef) {
      // The storage and the host reading it come from the cluster's own list,
      // on a cluster and a host the snapshot shows.
      const node = nodeRef ? resolveNode(ctx, nodeRef, clusterRef) : null
      const connection = node ? node.connection : resolveConnection(ctx, clusterRef)

      // The storage list route's own rule: a vDC tenant or a scoped user never
      // reads a pool of the cluster outside their slice.
      const caller = await resolveStorageCaller(connection.id)
      const visible = await storageVisibilityFilter(connection.id, ctx.tenantId, caller)
      const rows = (caller.allowed ? await storageRows(ctx, connection.id) : []).filter(
        r =>
          String(r?.storage).toLowerCase() === storageRef.toLowerCase() &&
          ctx.snapshot.nodes.some(n => n.connId === connection.id && n.name === r?.node) &&
          visible({ storage: r.storage, shared: r.shared, type: r.plugintype, node: r.node })
      )
      const onlyRow = rows.length === 1 ? rows[0] : undefined
      const row = node ? rows.find(r => r.node === node.node.name) : (rows.find(r => r.shared) ?? onlyRow)

      if (!row) {
        throw new ToolScopeError(
          rows.length > 1
            ? `"${storageRef}" is a local storage on several hosts (${rows.map(r => r.node).join(', ')}): pass node.`
            : `No storage "${storageRef}" visible on ${connection.name}.`
        )
      }

      connId = connection.id
      target = row.shared ? row.storage : `${row.storage} (${row.node})`
      path = `/nodes/${encodeURIComponent(row.node)}/storage/${encodeURIComponent(row.storage)}/rrddata`
      usedOf = r => (typeof r.used === 'number' && typeof r.total === 'number' && r.total > 0 ? (r.used / r.total) * 100 : null)
    } else {
      const { connection, node } = resolveNode(ctx, nodeRef, clusterRef)

      await requireNodeView(connection.id, node.name)

      connId = connection.id
      target = node.name
      path = `/nodes/${encodeURIComponent(node.name)}/rrddata`
      usedOf = r => (typeof r.memused === 'number' && typeof r.memtotal === 'number' && r.memtotal > 0 ? (r.memused / r.memtotal) * 100 : null)
    }

    const rows = await fetchRrd(ctx, connId, `${path}?timeframe=month&cf=AVERAGE`)
    const since = Date.now() / 1000 - 30 * 86_400
    const points = rows
      .filter(r => typeof r.time === 'number' && r.time >= since)
      .map(r => ({ time: Number(r.time), value: usedOf(r) }))
      .filter((p): p is { time: number; value: number } => p.value !== null)

    const metric = storageRef ? 'storage' : 'memory'
    const spanDays = points.length > 1 ? (points[points.length - 1].time - points[0].time) / 86_400 : 0

    if (spanDays < MIN_HISTORY_DAYS) {
      return { target, metric, note: `Only ${r1(spanDays)} days of history: too short for a trend.` }
    }

    const { slopePerDay, fittedNow } = linearTrend(points)
    const now = points[points.length - 1].value
    const daysTo = (level: number) => (slopePerDay > 0.001 && now < level ? Math.ceil((level - now) / slopePerDay) : null)
    const to90 = daysTo(90)
    const to100 = daysTo(100)

    const result: Record<string | symbol, unknown> = {
      target,
      metric,
      usedPctNow: r1(now),
      usedPctMonthAgo: r1(points[0].value),
      trendPointsPerDay: Math.round(slopePerDay * 100) / 100,
      growing: slopePerDay > 0.001,
      // Said outright: with no date to 90 % a model wrote "it will never go back under 90 %".
      alreadyAbove90Pct: now >= 90,
      reaches90PctInDays: to90,
      reaches90PctOn: to90 === null ? null : dateIn(to90, ctx.timeZone),
      reaches100PctInDays: to100,
      reaches100PctOn: to100 === null ? null : dateIn(to100, ctx.timeZone),
      fitQuality: Math.abs(fittedNow - now) < 5 ? 'steady' : 'irregular',
      note: 'A straight line through the last 30 days: a one-off copy or deletion bends it, so treat a date months away as an order of magnitude.',
    }

    result[CHART_SERIES] = {
      target,
      metric,
      timeframe: 'month',
      unit: '%',
      series: [metric === 'storage' ? 'used' : 'memory'],
      points: downsample(
        points.map(p => ({ time: p.time, values: [p.value] })),
        HISTORY_CHART_POINTS
      ).map(p => ({ time: p.time, values: [r1(p.values[0] ?? 0)] })),
    } satisfies HistorySeries

    return result
  },
}

/* ------------------------------------------------------------------ */
/* simulate_migration                                                 */
/* ------------------------------------------------------------------ */

export const simulateMigrationTool: CatalogTool = {
  name: 'simulate_migration',
  readOnly: true,
  description:
    'What-if, nothing is moved: would a VM or container fit on another host of its cluster? Compares its assigned RAM and vCPUs with the target host free RAM (after a 10 % host reserve) and core count, and gives the target load before and after. Answers "can I move db-01 to pve3?", "where can I put web-01?". Without a target, ranks the hosts of the cluster that could take it. Example: guest=\'db-01\', target=\'pve3\'',
  parameters: {
    type: 'object',
    properties: {
      guest: { type: 'string', description: 'VM or container name or vmid.' },
      target: { type: 'string', description: 'Destination host name. Omit to rank every possible host.' },
      count: { type: 'integer', description: 'How many guests of that size to place, for a sizing question.', default: 1, minimum: 1, maximum: 50 },
    },
  },
  execute: syncExecute((args, ctx) => {
    const guest = resolveGuest(ctx, argString(args, 'guest'))
    const count = argNumber(args, 'count', 1, { min: 1, max: 50 })
    const targetRef = argString(args, 'target')
    const hosts = ctx.snapshot.nodes.filter(n => n.connId === guest.connId && n.status === 'online' && n.name !== guest.node)

    const evaluate = (host: (typeof hosts)[number]) => {
      const reserve = (host.memTotalGb * HOST_RAM_RESERVE_PCT) / 100
      const free = Math.max(0, host.memTotalGb - host.memUsedGb - reserve)
      const ramNeeded = guest.memTotalGb * count
      const vcpusRunning = ctx.snapshot.guests
        .filter(g => g.connId === host.connId && g.node === host.name && g.status === 'running' && !g.template)
        .reduce((s, g) => s + (g.vcpus ?? 0), 0)
      const vcpusAfter = vcpusRunning + (guest.vcpus ?? 0) * count

      return {
        host: host.name,
        fits: ramNeeded <= free,
        ramFreeAfterReserveGb: r1(free),
        ramNeededGb: r1(ramNeeded),
        ramUsedPctBefore: host.memPct,
        ramUsedPctAfter: host.memTotalGb > 0 ? r1(((host.memUsedGb + ramNeeded) / host.memTotalGb) * 100) : null,
        cpuOvercommitAfter: host.cores ? r1(vcpusAfter / host.cores) : null,
        ...(host.maintenance ? { inMaintenance: true } : {}),
      }
    }

    const base = {
      guest: guest.name,
      vmid: guest.vmid,
      currentHost: guest.node,
      cluster: guest.cluster,
      assignedRamGb: guest.memTotalGb,
      vcpus: guest.vcpus ?? null,
      count,
      note: 'RAM is checked against what the host uses now; a guest on local storage also needs its disks moved, which this does not check.',
    }

    if (targetRef) {
      const { node } = resolveNode(ctx, targetRef, guest.cluster)

      if (node.connId !== guest.connId) throw new ToolArgumentError('The target host is in another cluster: this simulates a move within the cluster only.')
      if (node.name === guest.node) throw new ToolArgumentError(`${guest.name} already runs on ${node.name}.`)

      return { ...base, target: evaluate(node) }
    }

    return {
      ...base,
      candidates: hosts
        .filter(h => !h.maintenance)
        .map(evaluate)
        .sort((a, b) => Number(b.fits) - Number(a.fits) || b.ramFreeAfterReserveGb - a.ramFreeAfterReserveGb),
    }
  }),
}
