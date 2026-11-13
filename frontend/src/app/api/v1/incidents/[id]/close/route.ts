// POST /api/v1/incidents/[id]/close   close the incident once its alerts are resolved (the post-mortem is signed by the session)

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { incidentViewResponse } from '@/lib/incidents/alertVisibility'
import { requireIncidentWrite } from '@/lib/incidents/guard'
import { closeIncident, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const access = await requireIncidentWrite(id)
    if (access.denied) return access.denied

    return await incidentViewResponse(await closeIncident(id, { by: access.userName }), PERMISSIONS.ALERTS_MANAGE)
  } catch (e) {
    return incidentErrorResponse(e, 'close incident')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePost)
