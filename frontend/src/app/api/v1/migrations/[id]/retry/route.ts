import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { resolveRetryEngine, v2vConfigFromJobConfig } from "@/lib/migration/retry-dispatch"
import { runXcpngWarmMigration } from "@/lib/migration/warm/xcpng-warm-pipeline"
import { resolveInstanceId } from "@/lib/migration/orphan-sweep"

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
        // The retried pipeline runs in this process's after() continuation;
        // the owner tag lets the startup sweep fail it after a restart (#608).
        ownerInstanceId: resolveInstanceId(),
      },
    })

    const tenantId = await getCurrentTenantId()
    // Dispatch the retry to the same engine the original used: warm must not
    // fall back to a cold pipeline (it powers off the running source), and a
    // Hyper-V / vCenter / Nutanix / XCP-ng job must not be handed to the
    // direct-ESXi pipeline, which rejects any non-VMware source. The engine
    // comes from the sourceType persisted in the job config; jobs created
    // before that field existed fall back to the live source connection.
    // Resolve it while the request-scoped Prisma client is still alive; it may
    // be torn down inside after().
    const jobConfig = (job.config ?? {}) as Record<string, any>
    const sourceConn = await prisma.connection.findUnique({
      where: { id: job.sourceConnectionId },
      select: { type: true, subType: true },
    })
    const engine = resolveRetryEngine(jobConfig, sourceConn)
    after(async () => {
      switch (engine) {
        case "warm-xcpng":
          await runXcpngWarmMigration(newJob.id, config as unknown as Parameters<typeof runXcpngWarmMigration>[1], tenantId)
          return
        case "warm-vmware":
          await runWarmMigration(newJob.id, config as unknown as Parameters<typeof runWarmMigration>[1], tenantId)
          return
        case "v2v":
          await runV2vMigrationPipeline(newJob.id, v2vConfigFromJobConfig(jobConfig, job, sourceConn), tenantId)
          return
        case "xcpng-cold":
          await runXcpngMigrationPipeline(newJob.id, { ...config, migrationType: "cold" }, tenantId)
          return
        default:
          await runMigrationPipeline(newJob.id, config, tenantId)
      }
    })

    return NextResponse.json({ data: { jobId: newJob.id, status: "pending" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
