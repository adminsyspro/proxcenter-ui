import { NextResponse, after } from "next/server"

import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { runMigrationPipeline } from "@/lib/migration/pipeline"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/[id]/retry
 * Retry a failed migration
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)

    if (denied) return denied

    const session = await getServerSession(authOptions)
    const { id } = await params
    const job = await prisma.migrationJob.findUnique({ where: { id } })

    if (!job) {
      return NextResponse.json({ error: "Migration job not found" }, { status: 404 })
    }

    if (job.status !== "failed" && job.status !== "cancelled") {
      return NextResponse.json({ error: `Cannot retry a ${job.status} job` }, { status: 400 })
    }

    if (!job.config) {
      return NextResponse.json({ error: "No config saved for retry" }, { status: 400 })
    }

    // job.config is a JSONB column (see schema.prisma): Prisma returns the
    // parsed object directly. The shape is set at create time in
    // /api/v1/migrations/route.ts and matches MigrationConfig.
    const config = job.config as unknown as Parameters<typeof runMigrationPipeline>[1]

    // Defensive re-validation: historical rows predate the input grammar
    // check at create time, so we re-assert before shelling out.
    const {
      assertAbsPath,
      assertBridgeName,
      assertNodeName,
      assertStorageName,
      InvalidShellArgError,
    } = await import("@/lib/ssh/validate")

    try {
      assertNodeName(config.targetNode)
      assertStorageName(config.targetStorage)
      if (config.networkBridge) assertBridgeName(config.networkBridge)
      if (config.tempStorage) assertAbsPath(config.tempStorage)
    } catch (e) {
      if (e instanceof InvalidShellArgError) {
        return NextResponse.json({ error: `Stored migration config has invalid value: ${e.message}` }, { status: 400 })
      }

      throw e
    }

    // Create a new job for the retry
    const newJob = await prisma.migrationJob.create({
      data: {
        sourceConnectionId: job.sourceConnectionId,
        sourceVmId: job.sourceVmId,
        sourceVmName: job.sourceVmName,
        sourceHost: job.sourceHost,
        targetConnectionId: job.targetConnectionId,
        targetNode: job.targetNode,
        targetStorage: job.targetStorage,
        config: job.config,
        status: "pending",
        currentStep: "pending",
        startedAt: new Date(),
        createdBy: session?.user?.id || null,
      },
    })

    const tenantId = await getCurrentTenantId()

    after(async () => {
      await runMigrationPipeline(newJob.id, config, tenantId)
    })

    return NextResponse.json({ data: { jobId: newJob.id, status: "pending" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
