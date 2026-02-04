import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * POST /api/v1/pbs/[id]/jobs/gc/[jobId]/run
 * Exécute un Garbage Collection sur un datastore
 * Note: jobId est au format "gc-{datastore}"
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

    // Extract datastore from jobId (format: gc-{datastore})
    const datastore = jobId.replace(/^gc-/, '')

    const result = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(datastore)}/gc`, {
      method: 'POST'
    })

    return NextResponse.json({ 
      data: result,
      message: 'Garbage collection started'
    })
  } catch (e: any) {
    console.error("[pbs-gc-jobs] RUN Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
