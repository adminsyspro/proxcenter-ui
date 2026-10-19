import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { getSessionPrisma } from '@/lib/tenant'
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from '@/lib/tenant/infraScope'
import { prisma as globalPrisma } from '@/lib/db/prisma'
import { getCurrentRbacInfraScope, loadGuestVisibilityCheck, PERMISSIONS } from '@/lib/rbac'
import { filterCandidateConnections } from '@/lib/rbac/infraScope'
import { getOrchestratorClient, type TopGuests, type TopGuestsAgg, type TopGuestsMetric } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'

export const runtime = 'nodejs'

/**
 * Top N guests by a metric over a time window (#1129), merged across the PVE
 * connections the caller may see. The ranking itself comes from the
 * orchestrator's stored collections (one call per connection, every guest);
 * this route only applies the dashboard's visibility rules, merges, sorts and
 * cuts to the requested size.
 */

const METRICS: ReadonlySet<string> = new Set<TopGuestsMetric>(['cpu', 'ram', 'diskread', 'diskwrite', 'netin', 'netout'])
const AGGS: ReadonlySet<string> = new Set<TopGuestsAgg>(['avg', 'max'])
const LIMITS = [10, 20, 50]
const DEFAULT_LIMIT = 10
const DEFAULT_WINDOW_MS = 60 * 60 * 1000

export interface TopConsumerItem {
  connId: string
  connection: string
  vmid: number
  name: string
  node: string
  type?: string
  status: string
  value: number
  samples: number
}

function parseIsoDate(raw: string | null): Date | null | undefined {
  if (raw === null || raw === '') return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 10, 20 or 50; anything else, absent included, falls back to 10. */
function clampLimit(raw: string | null): number {
  const n = Number(raw)
  return LIMITS.includes(n) ? n : DEFAULT_LIMIT
}

function parseConnections(raw: string | null): Set<string> | null {
  if (!raw) return null
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean)
  return ids.length > 0 ? new Set(ids) : null
}

const unitOf = (metric: string) => (metric === 'cpu' || metric === 'ram' ? 'percent' : 'bytes_per_second')

const olderOf = (a: string | null, b: string | null | undefined) => {
  if (!b) return a
  if (!a) return b
  return new Date(b).getTime() < new Date(a).getTime() ? b : a
}

export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(req.url)
  const metric = url.searchParams.get('metric') || 'cpu'
  const agg = url.searchParams.get('agg') || 'avg'
  if (!METRICS.has(metric)) return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
  if (!AGGS.has(agg)) return NextResponse.json({ error: 'Unknown aggregation' }, { status: 400 })

  const toParsed = parseIsoDate(url.searchParams.get('to'))
  const fromParsed = parseIsoDate(url.searchParams.get('from'))
  if (toParsed === null || fromParsed === null) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const to = toParsed ?? new Date()
  const from = fromParsed ?? new Date(to.getTime() - DEFAULT_WINDOW_MS)
  if (from.getTime() >= to.getTime()) return NextResponse.json({ error: 'from must precede to' }, { status: 400 })

  const limit = clampLimit(url.searchParams.get('limit'))
  const wanted = parseConnections(url.searchParams.get('connections'))

  try {
    const userId = session.user.id
    const tenantId = (session as any).user?.tenantId || 'default'

    // Same candidate connections as the dashboard route: provider sees all,
    // msp its own (session client), iaas the connections its vDCs reference.
    const infra = await getTenantInfrastructureScope(tenantId)
    const plan = inventoryConnectionPlan(infra)
    const vdcScope = maskingScope(infra)
    const connPrisma = plan.pveClient === 'global' ? globalPrisma : await getSessionPrisma()
    const allConnections = await connPrisma.connection.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true },
    })

    let connections = allConnections.filter(c => c.type === 'pve')
    if (plan.pveConnectionIds) {
      const allowed = new Set(plan.pveConnectionIds)
      connections = connections.filter(c => allowed.has(c.id))
    }

    // Clusters the caller holds no grant on are not queried at all; a
    // guest-derived (tag / pool) scope keeps every candidate and relies on the
    // per-guest check below.
    const rbacScope = await getCurrentRbacInfraScope([PERMISSIONS.VM_VIEW, PERMISSIONS.NODE_VIEW])
    connections = filterCandidateConnections(connections, rbacScope)
    if (wanted) connections = connections.filter(c => wanted.has(c.id))

    // An unrestricted caller (null scope, not iaas) keeps every row the
    // orchestrator stored, guests deleted since included: that is the point of
    // a history. Everyone else is judged guest by guest; the predicate answers
    // false for a row without `type` (written before #1129), the safe default.
    const isVisible = rbacScope === null ? null : await loadGuestVisibilityCheck(userId, PERMISSIONS.VM_VIEW, tenantId)

    const client = getOrchestratorClient()
    const window = { metric: metric as TopGuestsMetric, agg: agg as TopGuestsAgg, from: from.toISOString(), to: to.toISOString(), limit: 0 }
    const results = await Promise.allSettled(connections.map(c => client.getTopGuests(c.id, window)))

    const merged: TopConsumerItem[] = []
    let answered = 0
    let unavailable = 0
    let firstSampleAt: string | null = null

    results.forEach((result, i) => {
      const conn = connections[i]

      if (result.status === 'rejected') {
        if (result.reason?.code === 'ORCHESTRATOR_UNAVAILABLE') unavailable++
        else console.warn(`[dashboard/top-consumers] ${conn.id}: ${result.reason?.message || result.reason}`)
        return
      }

      const payload: TopGuests | undefined = result.value?.data
      if (!payload) return
      answered++
      firstSampleAt = olderOf(firstSampleAt, payload.first_sample_at)

      const allowedPools = vdcScope?.poolsByConnection.get(conn.id)

      for (const item of payload.items || []) {
        // vDC masking: a guest outside every pool of the tenant's vDCs, or in
        // no pool at all, is not theirs (same rule as the dashboard).
        if (vdcScope && (!item.pool || !allowedPools?.has(item.pool))) continue
        if (isVisible && !isVisible({ connId: conn.id, node: item.node, type: item.type, vmid: item.vmid, tags: item.tags, pool: item.pool })) continue

        merged.push({
          connId: conn.id,
          connection: conn.name || conn.id,
          vmid: item.vmid,
          name: item.name,
          node: item.node,
          type: item.type,
          status: item.status,
          value: item.value,
          samples: item.samples,
        })
      }
    })

    // No orchestrator at all (every queried connection refused) reads
    // differently from "nothing to show": the widget says so.
    if (answered === 0 && unavailable > 0) {
      return NextResponse.json({ available: false, items: [] })
    }

    merged.sort((a, b) => b.value - a.value || (a.name || '').localeCompare(b.name || ''))

    return NextResponse.json({
      metric,
      agg,
      unit: unitOf(metric),
      from: from.toISOString(),
      to: to.toISOString(),
      firstSampleAt,
      items: merged.slice(0, limit),
    })
  } catch (e: any) {
    console.error('[dashboard/top-consumers] Error:', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
