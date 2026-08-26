import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { cancelMigrationJob } from "@/lib/migration/pipeline"
import { cancelWarmMigrationJob } from "@/lib/migration/warm/warm-pipeline"
import { cancelV2vMigrationJob } from "@/lib/migration/v2v-pipeline"
import { cancelXcpngMigrationJob } from "@/lib/migration/xcpng-pipeline"

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

    // Signal every job registry: the job may be running on the cold/live
    // pipeline, the warm orchestrator, the virt-v2v pipeline or the offline
    // XCP-ng pipeline, and each keeps its own cooperative cancel set.
    // Signalling all four is harmless for the others. The virt-v2v one matters
    // since #738: a job parked on the multi-boot gate polls that set, so without
    // this the cancel would only change the row and leave the pipeline waiting
    // until the gate expires.
    cancelMigrationJob(id)
    cancelWarmMigrationJob(id)
    cancelV2vMigrationJob(id)
    cancelXcpngMigrationJob(id)
    await prisma.migrationJob.update({
      where: { id },
      data: { status: "cancelled", currentStep: "cancelled", completedAt: new Date() },
    })

    return NextResponse.json({ data: { status: "cancelled" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
