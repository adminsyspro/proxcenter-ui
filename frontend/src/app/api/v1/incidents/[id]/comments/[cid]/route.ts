// PATCH  /api/v1/incidents/[id]/comments/[cid]   edit a comment, its author only
// DELETE /api/v1/incidents/[id]/comments/[cid]   delete a comment, its author or admin.settings

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { deleteComment, editComment, getIncident, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { parseCommentBody, readJson } from '@/lib/incidents/validate'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; cid: string }> }

async function handlePatch(request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseCommentBody(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const { id, cid } = await ctx.params
    // The orchestrator refuses an author other than the comment's.
    return NextResponse.json(await editComment(id, cid, { body: parsed.value.body, author_id: access.userId }))
  } catch (e) {
    return incidentErrorResponse(e, 'edit comment')
  }
}

async function handleDelete(_request: Request, ctx: Ctx) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const { id, cid } = await ctx.params
    const comment = (await getIncident(id)).comments?.find(c => c.id === cid)
    if (!comment) return codeResponse('not_found', 404)
    if (comment.author_id !== access.userId) {
      const permDenied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
      if (permDenied) return permDenied
    }
    return NextResponse.json(await deleteComment(id, cid))
  } catch (e) {
    return incidentErrorResponse(e, 'delete comment')
  }
}

export const PATCH = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePatch)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handleDelete)
