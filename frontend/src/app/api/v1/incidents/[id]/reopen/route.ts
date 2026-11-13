// POST /api/v1/incidents/[id]/reopen   reopen a closed incident

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { incidentViewResponse } from '@/lib/incidents/alertVisibility'
import { requireIncidentWrite } from '@/lib/incidents/guard'
import { incidentErrorResponse, reopenIncident } from '@/lib/incidents/orchestrator'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const access = await requireIncidentWrite(id)
    if (access.denied) return access.denied

    return await incidentViewResponse(await reopenIncident(id), PERMISSIONS.ALERTS_MANAGE)
  } catch (e) {
    return incidentErrorResponse(e, 'reopen incident')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePost)
