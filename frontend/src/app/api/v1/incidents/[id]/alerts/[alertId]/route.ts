// DELETE /api/v1/incidents/[id]/alerts/[alertId]   detach an alert from the incident

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { incidentViewResponse, refuseInvisibleAlert } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { detachAlert, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handleDelete(_request: Request, ctx: { params: Promise<{ id: string; alertId: string }> }) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const { id, alertId } = await ctx.params
    const refused = await refuseInvisibleAlert(alertId, PERMISSIONS.ALERTS_MANAGE)
    if (refused) return refused

    return await incidentViewResponse(await detachAlert(id, alertId), PERMISSIONS.ALERTS_MANAGE)
  } catch (e) {
    return incidentErrorResponse(e, 'detach alert')
  }
}

export const DELETE = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handleDelete)
