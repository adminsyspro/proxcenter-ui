import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * PUT /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Met à jour un Verify Job
 */
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params
    const body = await req.json()

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_EDIT, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const params: Record<string, any> = {}

    if (body.store) params.store = body.store
    if (body.ns !== undefined) params.ns = body.ns || null
    if (body.schedule !== undefined) params.schedule = body.schedule || null
    if (body.comment !== undefined) params.comment = body.comment || null
    if (body.ignoreVerified !== undefined) params['ignore-verified'] = body.ignoreVerified
    if (body.outdatedAfter !== undefined) params['outdated-after'] = body.outdatedAfter
    if (body.disable !== undefined) params.disable = body.disable

    const result = await pbsFetch<any>(conn, `/admin/verify/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })

    return NextResponse.json({ 
      data: result,
      message: 'Verify job updated successfully'
    })
  } catch (e: any) {
    console.error("[pbs-verify-jobs] PUT Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/verify/[jobId]
 * Supprime un Verify Job
 */
export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_DELETE, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    await pbsFetch<any>(conn, `/admin/verify/${encodeURIComponent(jobId)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      message: 'Verify job deleted successfully'
    })
  } catch (e: any) {
    console.error("[pbs-verify-jobs] DELETE Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
