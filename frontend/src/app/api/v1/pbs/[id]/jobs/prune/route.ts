import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/v1/pbs/[id]/jobs/prune
 * Crée un nouveau Prune Job sur PBS
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

    if (!body.id) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 })
    }

    if (!body.store) {
      return NextResponse.json({ error: "Datastore is required" }, { status: 400 })
    }

    const params: Record<string, any> = {
      id: body.id,
      store: body.store,
    }

    if (body.ns) params.ns = body.ns
    if (body.schedule) params.schedule = body.schedule
    if (body.comment) params.comment = body.comment
    if (body.maxDepth !== undefined) params['max-depth'] = body.maxDepth

    // Retention settings
    if (body.keepLast !== undefined && body.keepLast > 0) params['keep-last'] = body.keepLast
    if (body.keepHourly !== undefined && body.keepHourly > 0) params['keep-hourly'] = body.keepHourly
    if (body.keepDaily !== undefined && body.keepDaily > 0) params['keep-daily'] = body.keepDaily
    if (body.keepWeekly !== undefined && body.keepWeekly > 0) params['keep-weekly'] = body.keepWeekly
    if (body.keepMonthly !== undefined && body.keepMonthly > 0) params['keep-monthly'] = body.keepMonthly
    if (body.keepYearly !== undefined && body.keepYearly > 0) params['keep-yearly'] = body.keepYearly

    // PBS uses the datastore-specific endpoint for prune jobs
    const result = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(body.store)}/prune-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })

    return NextResponse.json({ 
      data: result,
      message: 'Prune job created successfully'
    })
  } catch (e: any) {
    console.error("[pbs-prune-jobs] POST Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
