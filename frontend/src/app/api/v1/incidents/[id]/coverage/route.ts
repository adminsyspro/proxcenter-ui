// GET /api/v1/incidents/[id]/coverage   which visible guest alerts of the incident reach the SLA report
//
// Asked by the panel only: the guest alerts no enabled policy of the Default
// tenant covers, and whether the incident enters the report at all. Judged on
// the alerts the caller may see, like the view itself.

import { NextResponse } from 'next/server'

import { visibleIncident } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { getIncident, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { slaCoverage } from '@/lib/incidents/slaCoverage'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const { id } = await ctx.params
    const view = await visibleIncident(await getIncident(id), PERMISSIONS.ALERTS_VIEW)
    if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json(await slaCoverage(view.alerts ?? []))
  } catch (e) {
    return incidentErrorResponse(e, 'incident coverage')
  }
}
