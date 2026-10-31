// GET    /api/v1/incidents/[id]   the incident with its alerts, comments and actions
// PATCH  /api/v1/incidents/[id]   title, root cause, impact
// DELETE /api/v1/incidents/[id]   admin.settings only
//
// The alerts of the view are the ones the caller may see (RBAC perimeter).

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { incidentViewResponse } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { deleteIncident, getIncident, incidentErrorResponse, patchIncident } from '@/lib/incidents/orchestrator'
import { parseIncidentPatch, readJson } from '@/lib/incidents/validate'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const { id } = await ctx.params
    const view = await getIncident(id)
    return await incidentViewResponse(view, PERMISSIONS.ALERTS_VIEW)
  } catch (e) {
    return incidentErrorResponse(e, 'get incident')
  }
}

async function handlePatch(request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseIncidentPatch(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const { id } = await ctx.params
    return await incidentViewResponse(await patchIncident(id, parsed.value), PERMISSIONS.ALERTS_MANAGE)
  } catch (e) {
    return incidentErrorResponse(e, 'update incident')
  }
}

async function handleDelete(_request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('admin')
    if (access.denied) return access.denied

    const { id } = await ctx.params
    return NextResponse.json(await deleteIncident(id))
  } catch (e) {
    return incidentErrorResponse(e, 'delete incident')
  }
}

export const PATCH = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id' }, handlePatch)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id' }, handleDelete)
