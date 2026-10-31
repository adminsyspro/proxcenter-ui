// POST /api/v1/incidents/[id]/alerts   attach an alert to the incident
//
// An alert outside the caller's perimeter is a 404 not_found, like the alert
// routes. The author is the session's.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { incidentViewResponse, refuseInvisibleAlert } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { attachAlert, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { parseAttachBody, readJson } from '@/lib/incidents/validate'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseAttachBody(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const refused = await refuseInvisibleAlert(parsed.value.alert_id, PERMISSIONS.ALERTS_MANAGE)
    if (refused) return refused

    const { id } = await ctx.params
    const view = await attachAlert(id, { alert_id: parsed.value.alert_id, by: access.userName })
    return await incidentViewResponse(view, PERMISSIONS.ALERTS_MANAGE)
  } catch (e) {
    return incidentErrorResponse(e, 'attach alert')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePost)
