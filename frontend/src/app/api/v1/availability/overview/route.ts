// GET /api/v1/availability/overview?period=24h, or ?period=custom&from=&to=
//
// The "health and availability" tab: per visible connection, the cluster row
// (whole connections only), one row per node and their rates, the instant
// state of the nodes and clusters, and the tiles. Only the connections the
// registry measures are shown; `unmeasured` counts the visible others, and
// `canConfigure` tells whether the caller may tick them. Enterprise only
// (`sla_monitoring`). An orchestrator out of reach is a 503 and no figure at
// all.

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { requireAvailabilitySettingsAccess, requireSlaRead } from '@/lib/availability/guard'
import {
  availabilityErrorResponse,
  codeResponse,
  currentAvailability,
  getMeasuredConnections,
  queryAvailability,
} from '@/lib/availability/orchestrator'
import { DEFAULT_PERIOD, parseWindow, windowBounds } from '@/lib/availability/period'
import { allowsInfraRef } from '@/lib/availability/scope'
import { summarize } from '@/lib/availability/summary'
import type { CurrentResponse, CurrentState, QueryResponse, Result, Summary } from '@/lib/availability/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ConnectionOverview {
  id: string
  name: string
  cluster: Result | null
  nodes: Result[]
  summary: Summary
}

const EMPTY_CURRENT: CurrentResponse = { collected_at: {}, states: [], covered_guests_down: null }
const EMPTY_QUERY: Pick<QueryResponse, 'results'> = { results: [] }

export async function GET(request: Request) {
  try {
    const access = await requireSlaRead()
    if (access.denied) return access.denied

    const requested = parseWindow(new URL(request.url).searchParams, DEFAULT_PERIOD)
    const bounds = requested === null ? null : windowBounds(requested, new Date())
    if (requested === null || bounds === null) return codeResponse('invalid_period', 400)

    const period = typeof requested === 'string' ? requested : 'custom'
    const { from, to, slotSeconds } = bounds
    // No visible connection: nothing to ask the orchestrator.
    const [measured, settingsAccess] = await Promise.all([
      access.connectionIds.length === 0 ? Promise.resolve([] as string[]) : getMeasuredConnections(),
      requireAvailabilitySettingsAccess(),
    ])
    const measuredSet = new Set(measured)
    const ids = access.connectionIds.filter(id => measuredSet.has(id))
    const common = { tenant_id: access.tenantId, scope: access.scope }

    // No visible connection: nothing to ask, the orchestrator refuses an empty target.
    const [query, current, rows] = ids.length === 0
      ? [EMPTY_QUERY, EMPTY_CURRENT, [] as { id: string; name: string }[]]
      : await Promise.all([
        queryAvailability({ ...common, from, to, slot_seconds: slotSeconds, connection_ids: ids }),
        currentAvailability({ ...common, connection_ids: ids, include_covered: true }),
        prisma.connection.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      ])

    const names = new Map(rows.map(r => [r.id, r.name]))
    const connections: ConnectionOverview[] = ids
      .map(id => {
        const own = query.results.filter(r => r.ref.connection_id === id && allowsInfraRef(access.scope, r.ref))
        const nodes = own.filter(r => r.ref.kind === 'node')
        return {
          id,
          name: names.get(id) ?? id,
          cluster: own.find(r => r.ref.kind === 'cluster') ?? null,
          nodes,
          summary: summarize(nodes),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    // Guests are not part of this tab: only the nodes and clusters go out.
    const states: CurrentState[] = current.states.filter(s => ids.includes(s.ref.connection_id) && allowsInfraRef(access.scope, s.ref))
    const nodeStates = states.filter(s => s.ref.kind === 'node')
    const clusterStates = states.filter(s => s.ref.kind === 'cluster')

    return NextResponse.json({
      period,
      from,
      to,
      connections,
      unmeasured: access.connectionIds.length - ids.length,
      canConfigure: !settingsAccess.denied,
      current: { states, collectedAt: current.collected_at },
      tiles: {
        nodesUp: nodeStates.filter(s => s.state === 'up').length,
        nodesTotal: nodeStates.length,
        clustersQuorate: clusterStates.filter(s => s.state === 'up').length,
        clustersTotal: clusterStates.length,
        nodesMaintenance: nodeStates.filter(s => s.state === 'maintenance').length,
        coveredGuestsDown: current.covered_guests_down,
        // Same aggregate as the per-connection summaries: nodes only, no cluster.
        coverage: summarize(connections.flatMap(c => c.nodes)).coverage,
      },
    })
  } catch (e) {
    return availabilityErrorResponse(e, 'overview')
  }
}
