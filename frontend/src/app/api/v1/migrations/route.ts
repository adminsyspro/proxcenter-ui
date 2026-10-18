import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { NicConfigError } from "@/lib/rbac/nicPermissions"
import { authOptions } from "@/lib/auth/config"
import { resolveInstanceId } from "@/lib/migration/orphan-sweep"
import { startMigrationJob } from "@/lib/migration/start-job"
import { validateMigrationRequest } from "@/lib/migration/validate-request"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations
 * Start a new external hypervisor → Proxmox migration (ESXi or XCP-ng)
 */
export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const tenantId = await getCurrentTenantId()
    const validated = await validateMigrationRequest(body, { prisma, tenantId })
    if (validated.ok === false) return validated.response
    const v = validated.value

    const job = await prisma.migrationJob.create({
      data: {
        sourceConnectionId: v.sourceConnectionId,
        sourceVmId: v.sourceVmId,
        sourceVmName: v.sourceVmName,
        sourceHost: v.sourceHost,
        targetConnectionId: v.targetConnectionId,
        targetNode: v.targetNode,
        targetStorage: v.targetStorage,
        config: v.config as any,
        status: "pending",
        currentStep: "pending",
        startedAt: new Date(),
        createdBy: session?.user?.id || null,
        // The pipeline runs in this process's after() continuation; the owner
        // tag lets the startup sweep fail the job if this server restarts (#608).
        ownerInstanceId: resolveInstanceId(),
      },
    })

    // Run the pipeline in background after the response (tenant-scoped DB access).
    after(async () => {
      await startMigrationJob({ ...job, config: v.config }, tenantId, v.sourceConn)
    })

    return NextResponse.json({ data: { jobId: job.id, status: "pending" } })
  } catch (e: any) {
    if (e instanceof NicConfigError) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * GET /api/v1/migrations
 * List migration jobs
 */
export async function GET() {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const jobs = await prisma.migrationJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return NextResponse.json({
      data: jobs.map(j => ({
        ...j,
        bytesTransferred: j.bytesTransferred ? Number(j.bytesTransferred) : null,
        totalBytes: j.totalBytes ? Number(j.totalBytes) : null,
        logs: j.logs ?? [],
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
