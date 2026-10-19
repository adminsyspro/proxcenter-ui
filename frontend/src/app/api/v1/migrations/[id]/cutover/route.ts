import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requestWarmCutover } from "@/lib/migration/warm/warm-pipeline"

export const runtime = "nodejs"

// Warm-only statuses; cold/live/v2v pipelines never reach these, so a status
// check alone gates this to interactive warm migrations.
const CUTOVER_ELIGIBLE = new Set(["delta_sync", "awaiting_cutover"])

/**
 * POST /api/v1/migrations/[id]/cutover
 * Ask a running warm migration to cut over now (accept the current downtime),
 * optionally with the guest conversion choice for this cutover (#1000).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const { id } = await params
    const job = await prisma.migrationJob.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    if (!CUTOVER_ELIGIBLE.has(job.status)) {
      return NextResponse.json({ error: `Cannot cut over a ${job.status} job` }, { status: 400 })
    }

    // Optional body (#1000): `{ convertGuest: boolean }`, the operator's guest
    // conversion choice for this cutover. Only a VMware warm job carries the
    // setting (its config holds the launch value); an empty body keeps it.
    const body = await req.json().catch(() => null) as { convertGuest?: unknown } | null
    const config = job.config && typeof job.config === "object" && !Array.isArray(job.config) ? job.config as Record<string, any> : {}
    let nextConfig: Record<string, any> | undefined
    if (body?.convertGuest !== undefined && body?.convertGuest !== null) {
      if (typeof body.convertGuest !== "boolean") {
        return NextResponse.json({ error: "convertGuest must be a boolean" }, { status: 400 })
      }
      if (typeof config.convertGuest !== "boolean") {
        return NextResponse.json({ error: "This migration does not offer a guest conversion at cutover" }, { status: 400 })
      }
      nextConfig = { ...config, convertGuest: body.convertGuest }
    }

    // The row is the signal: the pipeline mirrors it back into its own
    // registry (lib/migration/operator-signals). Writing it before the
    // in-process call is what makes the click survive a route handler that
    // does not share the pipeline's module instance, which is the normal case
    // in dev and with more than one frontend replica in production. The
    // conversion choice rides in the same write: the pipeline reads it back
    // from the row at cutover, and a retry replays it.
    await prisma.migrationJob.update({ where: { id }, data: { cutoverRequestedAt: new Date(), ...(nextConfig && { config: nextConfig }) } })
    requestWarmCutover(id)
    return NextResponse.json({ data: { status: "cutover_requested" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
