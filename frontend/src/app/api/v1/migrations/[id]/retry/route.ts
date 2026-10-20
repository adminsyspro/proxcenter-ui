import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { resolveInstanceId } from "@/lib/migration/orphan-sweep"
import { startMigrationJob } from "@/lib/migration/start-job"
import { authorizeMigrationTarget } from "@/lib/migration/authorize"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/[id]/retry
 * Retry a failed migration
 */
async function handlePost(
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

    // A retry replays the saved target and NICs: the user retrying must pass
    // the checks the creation route applies, not inherit the creator's (#317).
    const tenantId = await getCurrentTenantId()
    const saved = job.config as Record<string, any>
    const unauthorized = await authorizeMigrationTarget({
      tenantId,
      sourceConnectionId: job.sourceConnectionId,
      targetConnectionId: job.targetConnectionId,
      targetNode: job.targetNode,
      targetVmid: typeof saved.targetVmid === "number" ? saved.targetVmid : undefined,
      networkBridge: typeof saved.networkBridge === "string" ? saved.networkBridge : "vmbr0",
      vlanTag: typeof saved.vlanTag === "number" ? saved.vlanTag : undefined,
      nics: Array.isArray(saved.nics) ? saved.nics : undefined,
      copyVmk: typeof saved.copyVmk === "string" && saved.copyVmk !== "" ? saved.copyVmk : undefined,
    })
    if (unauthorized) return unauthorized

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

    // Dispatch the retry to the same engine the original used: warm must not
    // fall back to a cold pipeline (it powers off the running source), and a
    // Hyper-V / vCenter / Nutanix / XCP-ng job must not be handed to the
    // direct-ESXi pipeline, which rejects any non-VMware source. The engine
    // comes from the sourceType persisted in the job config; jobs created
    // before that field existed fall back to the live source connection,
    // resolved while the request-scoped Prisma client is still alive (it may
    // be torn down inside after()).
    const sourceConn = await prisma.connection.findUnique({
      where: { id: job.sourceConnectionId },
      select: { type: true, subType: true },
    })
    // The new row is a copy of the failed one: start it from the original's
    // fields and config under the new id.
    after(async () => {
      await startMigrationJob({ ...job, id: newJob.id }, tenantId, sourceConn ?? null)
    })

    return NextResponse.json({ data: { jobId: newJob.id, status: "pending" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "migration", resourceType: "migration", resourceParam: "id", action: "run" }, handlePost)
