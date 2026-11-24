import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { orchestratorFetch, parseOrchestratorError } from "@/lib/orchestrator/client"
import { buildPbsUpdateRequest, parsePbsUpdateOptions, pbsBackupJobs, upcomingBackupJobs } from "@/lib/pbs/updateRun"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/update/preflight
 *
 * What the backup server looks like before an update: pending packages,
 * running tasks, datastores, free space, and the Proxmox VE backup jobs that
 * write to it. Reads only; the package lists are refreshed on the server.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    // Scopes the connection to the caller's tenant.
    await getPbsConnectionById(id)

    const options = parsePbsUpdateOptions(await req.json().catch(() => ({})))
    const request = await buildPbsUpdateRequest(id, options)
    if ('error' in request) return NextResponse.json({ error: request.error, code: request.code }, { status: request.status })

    const [preflight, jobs] = await Promise.all([
      orchestratorFetch<Record<string, unknown>>("/rolling-updates/pbs/preflight", { method: "POST", body: request.payload, timeout: 58_000 }),
      pbsBackupJobs(id),
    ])

    return NextResponse.json({
      data: {
        ...preflight,
        backup_jobs: jobs,
        upcoming_backup_jobs: upcomingBackupJobs(jobs, Math.floor(Date.now() / 1000)),
      },
    })
  } catch (e: any) {
    const upstream = parseOrchestratorError(e)
    if (upstream) return NextResponse.json({ error: upstream.message }, { status: upstream.status })
    if (e?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("PBS update preflight error:", String(e?.message || e).replace(/[\r\n]/g, " "))

    return NextResponse.json({ error: e?.message || String(e) }, { status: e?.code === "ORCHESTRATOR_UNAVAILABLE" ? 503 : 500 })
  }
}
