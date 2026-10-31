// GET /api/v1/incidents/[id]/candidates   the alerts that could join the incident, within the caller's perimeter

import { NextResponse } from 'next/server'

import { filterVisibleAlerts, visibleAlertFilter } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { getIncidentCandidates, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const { id } = await ctx.params
    const { alerts } = await getIncidentCandidates(id)
    return NextResponse.json({ alerts: await filterVisibleAlerts(alerts ?? [], await visibleAlertFilter(PERMISSIONS.ALERTS_VIEW)) })
  } catch (e) {
    return incidentErrorResponse(e, 'incident candidates')
  }
}
