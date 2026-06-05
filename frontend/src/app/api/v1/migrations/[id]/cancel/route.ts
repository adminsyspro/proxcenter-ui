import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { cancelMigrationJob } from "@/lib/migration/pipeline"
import { cancelWarmMigrationJob } from "@/lib/migration/warm/warm-pipeline"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/[id]/cancel
 * Cancel a running migration
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

    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return NextResponse.json({ error: `Cannot cancel a ${job.status} job` }, { status: 400 })
    }

    // Signal both job registries: the job may be running on either the
    // cold/live pipeline or the warm orchestrator, and each keeps its own
    // cooperative cancel set. Signalling both is harmless for the other.
    cancelMigrationJob(id)
    cancelWarmMigrationJob(id)
    await prisma.migrationJob.update({
      where: { id },
      data: { status: "cancelled", currentStep: "cancelled", completedAt: new Date() },
    })

    return NextResponse.json({ data: { status: "cancelled" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
