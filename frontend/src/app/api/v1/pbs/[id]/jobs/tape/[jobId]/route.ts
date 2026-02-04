import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * PUT /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Met à jour un Tape Backup Job
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
    if (body.pool) params.pool = body.pool
    if (body.drive) params.drive = body.drive
    if (body.ns !== undefined) params.ns = body.ns || null
    if (body.schedule !== undefined) params.schedule = body.schedule || null
    if (body.comment !== undefined) params.comment = body.comment || null
    if (body.ejectMedia !== undefined) params['eject-media'] = body.ejectMedia
    if (body.exportMediaSet !== undefined) params['export-media-set'] = body.exportMediaSet
    if (body.latestOnly !== undefined) params['latest-only'] = body.latestOnly
    if (body.disable !== undefined) params.disable = body.disable

    const result = await pbsFetch<any>(conn, `/config/tape-backup-job/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })

    return NextResponse.json({ 
      data: result,
      message: 'Tape backup job updated successfully'
    })
  } catch (e: any) {
    console.error("[pbs-tape-jobs] PUT Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/tape/[jobId]
 * Supprime un Tape Backup Job
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

    await pbsFetch<any>(conn, `/config/tape-backup-job/${encodeURIComponent(jobId)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      message: 'Tape backup job deleted successfully'
    })
  } catch (e: any) {
    console.error("[pbs-tape-jobs] DELETE Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
