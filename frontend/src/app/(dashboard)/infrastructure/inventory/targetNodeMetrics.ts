// Live load of the target nodes of a migration follow-up (roadmap#53 part B).
//
// One `rrddata` read per node, all nodes of the connection in one request
// (POST /connections/[id]/rrd/batch, through fetchRrdBatch): the last point of
// the "hour" series carries everything the cards show (cpu, iowait, memused,
// memtotal, netin), where /nodes/[node]/status has no network rate and the
// node list neither IO delay nor network.

import { bulkJobState } from './bulkJobList'
import { fetchRrdBatch } from './helpers'

export interface NodeLiveMetrics {
  /** 0..1 */
  cpu: number
  memUsed: number
  memTotal: number
  /** 0..1 */
  iowait: number
  /** Bytes per second received, all interfaces. */
  netin: number
  /** Epoch seconds of the point. */
  time: number
}

const num = (v: unknown): number | null => {
  let n = Number.NaN
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && v !== '') n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The newest complete point of a node's rrddata. Proxmox closes the current
 * minute late, so the last rows can come back without values: they are skipped
 * rather than read as an idle node.
 */
export function readNodeRrdPoint(rows: unknown): NodeLiveMetrics | null {
  if (!Array.isArray(rows)) return null
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = rows[i] as Record<string, unknown> | null
    const cpu = num(p?.cpu)
    if (p == null || cpu == null) continue
    return {
      cpu,
      memUsed: num(p.memused ?? p.mem) ?? 0,
      memTotal: num(p.memtotal ?? p.maxmem) ?? 0,
      iowait: num(p.iowait) ?? 0,
      netin: num(p.netin) ?? 0,
      time: num(p.time) ?? 0,
    }
  }
  return null
}

/** The live metrics of each node that answered; a node missing from the result is unreachable. */
export async function fetchTargetNodeMetrics(connectionId: string, nodes: string[], signal?: AbortSignal): Promise<Record<string, NodeLiveMetrics>> {
  if (!connectionId || nodes.length === 0) return {}
  const paths = nodes.map(n => `/nodes/${n}`)
  const map = await fetchRrdBatch(connectionId, paths, 'hour', signal)
  const out: Record<string, NodeLiveMetrics> = {}
  nodes.forEach((n, i) => {
    const point = readNodeRrdPoint(map.get(paths[i]))
    if (point) out[n] = point
  })
  return out
}

/** Bar colour of a live load: primary, orange past 85 %, red past 95 %. */
export function liveLoadColor(ratio: number): 'success.main' | 'warning.main' | 'error.main' {
  if (ratio > 0.95) return 'error.main'
  if (ratio > 0.85) return 'warning.main'
  // Not the theme's primary: on the ProxCenter theme it is orange and reads as the warning.
  return 'success.main'
}

/** Jobs of the follow-up on each target node: total, running, queued. */
export function jobsPerTargetNode(jobs: Array<{ status: string; targetNode?: string | null }>): Record<string, { total: number; running: number; queued: number }> {
  const out: Record<string, { total: number; running: number; queued: number }> = {}
  for (const j of jobs) {
    if (!j.targetNode) continue
    const c = (out[j.targetNode] ||= { total: 0, running: 0, queued: 0 })
    c.total++
    const s = bulkJobState(j.status)
    if (s === 'active') c.running++
    else if (s === 'queued') c.queued++
  }
  return out
}
