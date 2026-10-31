// POST /api/v1/incidents/[id]/comments   add a comment to the journal
//
// The author is the session's, whatever the body says. The text is stored as
// is and always rendered as text.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { codeResponse } from '@/lib/availability/orchestrator'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { addComment, incidentErrorResponse } from '@/lib/incidents/orchestrator'
import { parseCommentBody, readJson } from '@/lib/incidents/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireIncidentAccess('write')
    if (access.denied) return access.denied

    const parsed = parseCommentBody(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)

    const { id } = await ctx.params
    const comment = await addComment(id, { ...parsed.value, author_id: access.userId, author_name: access.userName })
    return NextResponse.json(comment, { status: 201 })
  } catch (e) {
    return incidentErrorResponse(e, 'add comment')
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'incident', resourceParam: 'id', action: 'update' }, handlePost)
