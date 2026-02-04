import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * POST /api/v1/pbs/[id]/jobs/sync/[jobId]/run
 * Exécute un Sync Job immédiatement
 */
export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_RUN, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const result = await pbsFetch<any>(conn, `/admin/sync/${encodeURIComponent(jobId)}/run`, {
      method: 'POST'
    })

    return NextResponse.json({ 
      data: result,
      message: 'Sync job started'
    })
  } catch (e: any) {
    console.error("[pbs-sync-jobs] RUN Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
