import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import { demoResponse } from "@/lib/demo/demo-api"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { orchestratorFetch, orchestratorSegment, parseOrchestratorError } from "@/lib/orchestrator/client"
import { buildPbsUpdateRequest, latestPbsRun, parsePbsUpdateOptions } from "@/lib/pbs/updateRun"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { publicRollingUpdate } from "@/lib/rollingUpdate/publicRollingUpdate"
import { getSessionPrisma } from "@/lib/tenant"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

function failure(e: any, what: string) {
  const upstream = parseOrchestratorError(e)
  if (upstream) return NextResponse.json({ error: upstream.message }, { status: upstream.status })
  if (e?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error(`PBS update ${what} error:`, String(e?.message || e).replace(/[\r\n]/g, " "))

  return NextResponse.json({ error: e?.message || String(e) }, { status: e?.code === "ORCHESTRATOR_UNAVAILABLE" ? 503 : 500 })
}

/** A run of this backup server, never one of another connection. */
async function runOf(id: string, runId: string) {
  const run = await orchestratorFetch<Record<string, any>>(`/rolling-updates/${orchestratorSegment(runId)}`)

  return run?.connection_id === id && run?.kind === "pbs" ? publicRollingUpdate(run) : null
}

/**
 * GET /api/v1/pbs/[id]/update
 *
 * Whether the server can be updated from here (SSH saved on the connection)
 * and its run: the one named by ?run=, otherwise the most recent.
 */
export async function GET(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    await getPbsConnectionById(id)

    const db = await getSessionPrisma()
    const connection = await db.connection.findUnique({ where: { id }, select: { sshEnabled: true } })
    const sshEnabled = !!connection?.sshEnabled
    const runId = new URL(req.url).searchParams.get("run")

    try {
      const run = runId
        ? await runOf(id, runId)
        : publicRollingUpdate(latestPbsRun<Record<string, any>>(await orchestratorFetch(`/rolling-updates?connection_id=${encodeURIComponent(id)}`)))

      return NextResponse.json({ data: { sshEnabled, orchestrator: true, run } })
    } catch (e: any) {
      // Without the orchestrator (Community, or it is down) there is no run to show.
      if (runId) throw e

      return NextResponse.json({ data: { sshEnabled, orchestrator: false, run: null } })
    }
  } catch (e: any) {
    return failure(e, "status")
  }
}

/** POST /api/v1/pbs/[id]/update: start the update. */
async function handlePost(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    await getPbsConnectionById(id)

    const options = parsePbsUpdateOptions(await req.json().catch(() => ({})))
    const request = await buildPbsUpdateRequest(id, options)
    if ('error' in request) return NextResponse.json({ error: request.error, code: request.code }, { status: request.status })

    const run = await orchestratorFetch<Record<string, any>>("/rolling-updates/pbs", { method: "POST", body: request.payload, timeout: 58_000 })

    return NextResponse.json({ data: publicRollingUpdate(run) }, { status: 201 })
  } catch (e: any) {
    return failure(e, "start")
  }
}

/** DELETE /api/v1/pbs/[id]/update?run=: cancel the run. */
async function handleDelete(req: Request, ctx: Ctx) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    await getPbsConnectionById(id)

    const runId = new URL(req.url).searchParams.get("run")
    if (!runId) return NextResponse.json({ error: "Missing run" }, { status: 400 })
    if (!(await runOf(id, runId))) return NextResponse.json({ error: "Update not found" }, { status: 404 })

    await orchestratorFetch(`/rolling-updates/${orchestratorSegment(runId)}/cancel`, { method: "POST" })

    return NextResponse.json({ data: { cancelled: true } })
  } catch (e: any) {
    return failure(e, "cancel")
  }
}

export const POST = withAudit({ category: "backups", resourceType: "pbs", resourceParam: "id", action: "update" }, handlePost)
export const DELETE = withAudit({ category: "backups", resourceType: "pbs", resourceParam: "id", action: "cancel" }, handleDelete)
