import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/v1/pbs/[id]/jobs/tape
 * Crée un nouveau Tape Backup Job sur PBS
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const body = await req.json()

    if (!id) {
      return NextResponse.json({ error: "Missing PBS connection ID" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_CREATE, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    // Validation
    if (!body.id) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 })
    }

    if (!body.store) {
      return NextResponse.json({ error: "Datastore is required" }, { status: 400 })
    }

    if (!body.pool) {
      return NextResponse.json({ error: "Media Pool is required" }, { status: 400 })
    }

    if (!body.drive) {
      return NextResponse.json({ error: "Drive is required" }, { status: 400 })
    }

    const params: Record<string, any> = {
      id: body.id,
      store: body.store,
      pool: body.pool,
      drive: body.drive,
    }

    if (body.ns) params.ns = body.ns
    if (body.schedule) params.schedule = body.schedule
    if (body.comment) params.comment = body.comment
    if (body.ejectMedia) params['eject-media'] = true
    if (body.exportMediaSet) params['export-media-set'] = true
    if (body.latestOnly) params['latest-only'] = true
    if (body.notifyUser) params['notify-user'] = body.notifyUser
    if (body.maxDepth !== undefined) params['max-depth'] = body.maxDepth

    const result = await pbsFetch<any>(conn, "/config/tape-backup-job", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })

    return NextResponse.json({ 
      data: result,
      message: 'Tape backup job created successfully'
    })
  } catch (e: any) {
    console.error("[pbs-tape-jobs] POST Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
