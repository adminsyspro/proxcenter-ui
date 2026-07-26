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
 * Ask a running warm migration to cut over now (accept the current downtime).
 */
export async function POST(
  _req: Request,
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

    requestWarmCutover(id)
    return NextResponse.json({ data: { status: "cutover_requested" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
