// POST /api/v1/incidents/[id]/actions   add a corrective action

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { addAction, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { parseActionBody, readJson } from '@/lib/incidents/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseActionBody(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const { id } = await ctx.params
    return NextResponse.json(await addAction(id, parsed.value), { status: 201 })
  } catch (e) {
    return incidentErrorResponse(e, 'add action')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePost)
