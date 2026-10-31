// GET /api/v1/incidents/[id]/context   the incident and the outages of its alerts, for the post-mortem

import { NextResponse } from 'next/server'

import { outagesOfAlerts, visibleIncident } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { getIncidentContext, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const { id } = await ctx.params
    const context = await getIncidentContext(id)
    const incident = await visibleIncident(context.incident, PERMISSIONS.ALERTS_VIEW)
    if (!incident) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // Only the outages of an object that one of the visible alerts describes.
    return NextResponse.json({ ...context, incident, outages: outagesOfAlerts(context.outages ?? [], incident.alerts) })
  } catch (e) {
    return incidentErrorResponse(e, 'incident context')
  }
}
