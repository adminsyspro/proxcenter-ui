import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/v1/pbs/[id]/jobs/sync
 * Crée un nouveau Sync Job sur PBS
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

    if (!body.remote) {
      return NextResponse.json({ error: "Remote is required" }, { status: 400 })
    }

    if (!body.remoteStore) {
      return NextResponse.json({ error: "Remote datastore is required" }, { status: 400 })
    }

    // Build params for PBS API
    const params: Record<string, any> = {
      id: body.id,
      store: body.store,
      remote: body.remote,
      'remote-store': body.remoteStore,
    }

    if (body.ns) params.ns = body.ns
    if (body.remoteNs) params['remote-ns'] = body.remoteNs
    if (body.schedule) params.schedule = body.schedule
    if (body.comment) params.comment = body.comment
    if (body.removeVanished) params['remove-vanished'] = true
    if (body.maxDepth !== undefined) params['max-depth'] = body.maxDepth

    const result = await pbsFetch<any>(conn, "/admin/sync", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })

    return NextResponse.json({ 
      data: result,
      message: 'Sync job created successfully'
    })
  } catch (e: any) {
    console.error("[pbs-sync-jobs] POST Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
