// GET /api/v1/incidents/[id]/report   the incident as a PDF to share
//
// Built from the alerts the caller may see, like the panel; internal notes
// never reach it. Labels follow the reader's language.

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { visibleIncident } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { getIncident, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { renderIncidentReport } from '@/lib/incidents/reportPdf'
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

    return await renderIncidentReport(view, (await cookies()).get('NEXT_LOCALE')?.value)
  } catch (e) {
    return incidentErrorResponse(e, 'incident report')
  }
}
