// PATCH  /api/v1/incidents/[id]/actions/[aid]   edit the text or tick a corrective action
// DELETE /api/v1/incidents/[id]/actions/[aid]   delete it

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { deleteAction, incidentErrorResponse, updateAction } from '@/lib/incidents/orchestrator'
import { parseActionPatch, readJson } from '@/lib/incidents/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; aid: string }> }

async function handlePatch(request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseActionPatch(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const { id, aid } = await ctx.params
    return NextResponse.json(await updateAction(id, aid, { ...parsed.value, by: access.userName }))
  } catch (e) {
    return incidentErrorResponse(e, 'update action')
  }
}

async function handleDelete(_request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const { id, aid } = await ctx.params
    return NextResponse.json(await deleteAction(id, aid))
  } catch (e) {
    return incidentErrorResponse(e, 'delete action')
  }
}

export const PATCH = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePatch)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handleDelete)
