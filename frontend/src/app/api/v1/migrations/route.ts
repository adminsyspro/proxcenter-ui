import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"

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

    const {
      sourceConnectionId,
      sourceVmId,
      targetConnectionId,
      targetNode,
      targetStorage,
      networkBridge = "vmbr0",
      startAfterMigration = false,
      migrationType = "cold",
      transferMode = "auto",
    } = body

    if (!sourceConnectionId || !sourceVmId || !targetConnectionId || !targetNode || !targetStorage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Verify connections exist
    const [sourceConn, pveConn] = await Promise.all([
      prisma.connection.findUnique({ where: { id: sourceConnectionId }, select: { id: true, type: true, subType: true, name: true, baseUrl: true } }),
      prisma.connection.findUnique({ where: { id: targetConnectionId }, select: { id: true, type: true, name: true } }),
    ])

    const validSourceTypes = ["vmware", "xcpng", "hyperv", "nutanix"]
    if (!sourceConn || !validSourceTypes.includes(sourceConn.type)) {
      return NextResponse.json({ error: "Source hypervisor connection not found (must be vmware, xcpng, hyperv, or nutanix)" }, { status: 404 })
    }
    if (!pveConn || pveConn.type !== "pve") {
      return NextResponse.json({ error: "Proxmox connection not found" }, { status: 404 })
    }

    // Detect effective source type: vmware with subType "vcenter" routes to v2v pipeline
    let effectiveSourceType: string = sourceConn.type
    if (sourceConn.type === "vmware" && sourceConn.subType === "vcenter") {
      effectiveSourceType = "vcenter"
    }

    // Create job record
    const job = await prisma.migrationJob.create({
      data: {
        sourceConnectionId,
        sourceVmId,
        sourceVmName: body.sourceVmName || null,
        sourceHost: sourceConn.baseUrl,
        targetConnectionId,
        targetNode,
        targetStorage,
        config: JSON.stringify({ sourceConnectionId, sourceVmId, sourceVmName: body.sourceVmName, targetConnectionId, targetNode, targetStorage, networkBridge, startAfterMigration, migrationType, transferMode, sourceType: effectiveSourceType }),
        status: "pending",
        currentStep: "pending",
        startedAt: new Date(),
        createdBy: session?.user?.id || null,
      },
    })

    const migrationConfig = {
      sourceConnectionId,
      sourceVmId,
      targetConnectionId,
      targetNode,
      targetStorage,
      networkBridge,
      startAfterMigration,
      migrationType: migrationType as "cold" | "live" | "sshfs_boot",
      transferMode: transferMode as "https" | "sshfs",
    }

    // Run appropriate pipeline in background after response (pass tenantId for scoped DB access)
    const tenantId = await getCurrentTenantId()
    after(async () => {
      if (effectiveSourceType === "vcenter" || effectiveSourceType === "hyperv" || effectiveSourceType === "nutanix") {
        const { sourceVmName = "", vcenterDatacenter, vcenterCluster, vcenterHost, diskPaths, tempStorage } = body
        await runV2vMigrationPipeline(job.id, {
          sourceConnectionId, sourceVmId, sourceVmName,
          sourceType: effectiveSourceType as "vcenter" | "hyperv" | "nutanix",
          targetConnectionId, targetNode, targetStorage, networkBridge, startAfterMigration,
          vcenterDatacenter, vcenterCluster, vcenterHost, diskPaths, tempStorage,
        }, tenantId)
      } else if (effectiveSourceType === "xcpng") {
        await runXcpngMigrationPipeline(job.id, { ...migrationConfig, migrationType: (migrationType === "sshfs_boot" ? "cold" : migrationType) as "cold" | "live" }, tenantId)
      } else {
        await runMigrationPipeline(job.id, migrationConfig, tenantId)
      }
    })

    return NextResponse.json({ data: { jobId: job.id, status: "pending" } })
  } catch (e: any) {
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
        logs: j.logs ? JSON.parse(j.logs) : [],
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
