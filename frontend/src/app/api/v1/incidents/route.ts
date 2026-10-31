// GET  /api/v1/incidents?status=&from=&to=&limit=&offset=   the register, newest first
// POST /api/v1/incidents                                    open an incident from an alert
//
// Default tenant, `incidents` feature; alerts.view to read, alerts.manage to
// write. The author is the session's: a created_by in the body is ignored.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { incidentViewResponse, refuseInvisibleAlert, visibleIncidents } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { createIncident, incidentErrorResponse, listIncidents } from '@/lib/incidents/orchestrator'
import { parseCreateBody, readJson } from '@/lib/incidents/validate'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const params = new URL(request.url).searchParams
    const data = await listIncidents({
      status: params.get('status') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      limit: params.get('limit') ?? undefined,
      offset: params.get('offset') ?? undefined,
    })
    // An incident with no visible alert is not listed, and the total follows.
    const { views, hidden } = await visibleIncidents(data.incidents ?? [], PERMISSIONS.ALERTS_VIEW)
    return NextResponse.json({ ...data, incidents: views, total: Math.max(0, (data.total ?? views.length + hidden) - hidden) })
  } catch (e) {
    return incidentErrorResponse(e, 'list incidents')
  }
}

async function handlePost(request: Request) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseCreateBody(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const refused = await refuseInvisibleAlert(parsed.value.alert_id, PERMISSIONS.ALERTS_MANAGE)
    if (refused) return refused

    const view = await createIncident({ ...parsed.value, created_by: access.userName })
    return await incidentViewResponse(view, PERMISSIONS.ALERTS_MANAGE, { status: 201 })
  } catch (e) {
    return incidentErrorResponse(e, 'create incident')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceNameBodyField: 'title' }, handlePost)
