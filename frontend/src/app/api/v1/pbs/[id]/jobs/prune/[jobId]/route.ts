import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * PUT /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Met à jour un Prune Job
 * Note: jobId format attendu: "datastore:jobid" ou on utilise le store du body
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

    // Le store est nécessaire pour l'endpoint
    const store = body.store || body.datastore

    if (!store) {
      return NextResponse.json({ error: "Datastore is required" }, { status: 400 })
    }

    const params: Record<string, any> = {}

    if (body.ns !== undefined) params.ns = body.ns || null
    if (body.schedule !== undefined) params.schedule = body.schedule || null
    if (body.comment !== undefined) params.comment = body.comment || null
    if (body.disable !== undefined) params.disable = body.disable

    // Retention settings
    if (body.keepLast !== undefined) params['keep-last'] = body.keepLast || null
    if (body.keepHourly !== undefined) params['keep-hourly'] = body.keepHourly || null
    if (body.keepDaily !== undefined) params['keep-daily'] = body.keepDaily || null
    if (body.keepWeekly !== undefined) params['keep-weekly'] = body.keepWeekly || null
    if (body.keepMonthly !== undefined) params['keep-monthly'] = body.keepMonthly || null
    if (body.keepYearly !== undefined) params['keep-yearly'] = body.keepYearly || null

    const result = await pbsFetch<any>(
      conn, 
      `/admin/datastore/${encodeURIComponent(store)}/prune-job/${encodeURIComponent(jobId)}`, 
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      }
    )

    return NextResponse.json({ 
      data: result,
      message: 'Prune job updated successfully'
    })
  } catch (e: any) {
    console.error("[pbs-prune-jobs] PUT Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Supprime un Prune Job
 * Note: Nécessite le store dans les query params
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params
    const { searchParams } = new URL(req.url)
    const store = searchParams.get('store')

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    if (!store) {
      return NextResponse.json({ error: "Store parameter is required" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_DELETE, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    await pbsFetch<any>(
      conn, 
      `/admin/datastore/${encodeURIComponent(store)}/prune-job/${encodeURIComponent(jobId)}`, 
      {
        method: 'DELETE'
      }
    )

    return NextResponse.json({ 
      message: 'Prune job deleted successfully'
    })
  } catch (e: any) {
    console.error("[pbs-prune-jobs] DELETE Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
