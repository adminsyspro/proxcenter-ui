import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId, getTenantPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
import { soapLogin, soapLogout, soapGetVmConfig, parseVmConfig } from "@/lib/vmware/soap"
import { decryptSecret } from "@/lib/crypto/secret"

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
      // Pass through the user-selected Temporary Storage so the direct-ESXi pipeline
      // keeps SSHFS mounts + VMDK dumps + clone targets off /tmp when the user has picked
      // a proper filesystem in the dialog.
      ...(body.tempStorage && { tempStorage: body.tempStorage as string }),
    }

    // Run appropriate pipeline in background after response (pass tenantId for scoped DB access)
    const tenantId = await getCurrentTenantId()
    after(async () => {
      if (effectiveSourceType === "vcenter" || effectiveSourceType === "hyperv" || effectiveSourceType === "nutanix") {
        const { sourceVmName = "", vcenterDatacenter, vcenterCluster, vcenterHost, diskPaths, tempStorage } = body
        // Live migration via NFC-on-snapshot is only plumbed for vcenter today.
        // Hyper-V and Nutanix still force cold: their pipelines don't own the
        // source VM snapshot surface that live needs to keep the source running.
        const v2vMigrationType: "cold" | "live" =
          effectiveSourceType === "vcenter" && migrationType === "live" ? "live" : "cold"
        await runV2vMigrationPipeline(job.id, {
          sourceConnectionId, sourceVmId, sourceVmName,
          sourceType: effectiveSourceType as "vcenter" | "hyperv" | "nutanix",
          targetConnectionId, targetNode, targetStorage, networkBridge, startAfterMigration,
          vcenterDatacenter, vcenterCluster, vcenterHost, diskPaths, tempStorage,
          migrationType: v2vMigrationType,
        }, tenantId)
      } else if (effectiveSourceType === "xcpng") {
        await runXcpngMigrationPipeline(job.id, { ...migrationConfig, migrationType: (migrationType === "sshfs_boot" ? "cold" : migrationType) as "cold" | "live" }, tenantId)
      } else if (effectiveSourceType === "vmware" && migrationType === "cold") {
        // Direct-ESXi Cold: Windows guests get routed through virt-v2v for automatic
        // driver injection (viostor registry + virtio-win-guest-tools firstboot).
        // Linux guests stay on the fast in-house pipeline since they boot on any bus
        // and don't need driver stitching. We resolve guestOS + vmPathName here via
        // SOAP so the routing decision has ground truth (frontend hints could be stale).
        let routeToV2v = false
        let vmPathName = ""
        let esxiHostname = ""
        try {
          // Use a fresh tenant-scoped prisma inside after() — the request-scoped
          // prisma from getSessionPrisma() may have been torn down by the framework
          // once the response was sent.
          const afterPrisma = getTenantPrisma(tenantId)
          const authCreds = await afterPrisma.connection.findUnique({
            where: { id: sourceConnectionId },
            select: { apiTokenEnc: true, baseUrl: true, insecureTLS: true, sshKeyEnc: true, sshPassEnc: true, sshEnabled: true },
          })
          if (authCreds?.apiTokenEnc) {
            const creds = decryptSecret(authCreds.apiTokenEnc)
            const colonIdx = creds.indexOf(":")
            const esxiUser = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
            const esxiPass = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
            const soap = await soapLogin(authCreds.baseUrl.replace(/\/$/, ""), esxiUser, esxiPass, authCreds.insecureTLS)
            try {
              const xml = await soapGetVmConfig(soap, sourceVmId)
              const parsed = parseVmConfig(xml)
              vmPathName = parsed.vmPathName || ""
              try { esxiHostname = new URL(authCreds.baseUrl).hostname } catch { esxiHostname = "" }
              const isWindowsGuest = /win/i.test(parsed.guestOS) || /win/i.test(parsed.guestId)
              // virt-v2v -i vmx -it ssh needs SSH auth on the ESXi source. The v2v
              // pipeline handles both: it reuses the stored key when present, or
              // bootstraps a one-shot key via sshpass when only a password is
              // configured (same pattern as pipeline.ts SSHFS Boot). So we only
              // require `sshEnabled` plus *some* credential here.
              const hasSshCredential = !!authCreds.sshKeyEnc || !!authCreds.sshPassEnc
              if (isWindowsGuest && vmPathName && authCreds.sshEnabled && hasSshCredential) {
                routeToV2v = true
              }
            } finally {
              await soapLogout(soap).catch(() => {})
            }
          }
        } catch {
          // SOAP lookup failed for the routing decision — fall back to the in-house
          // pipeline rather than blocking the migration. The in-house pipeline does
          // its own SOAP login and will surface any real auth/connectivity problem.
          routeToV2v = false
        }

        if (routeToV2v) {
          // Convert "[Datastore] folder/VmName.vmx" → "/vmfs/volumes/Datastore/folder/VmName.vmx"
          const vmxMatch = vmPathName.match(/^\[([^\]]+)\]\s+(.+)$/)
          const datastore = vmxMatch?.[1] || ""
          const relPath = vmxMatch?.[2] || ""
          const posixVmxPath = datastore && relPath ? `/vmfs/volumes/${datastore}/${relPath}` : ""
          if (posixVmxPath && esxiHostname) {
            await runV2vMigrationPipeline(job.id, {
              sourceConnectionId, sourceVmId, sourceVmName: body.sourceVmName || "",
              sourceType: "esxi-direct",
              targetConnectionId, targetNode, targetStorage, networkBridge, startAfterMigration,
              tempStorage: body.tempStorage,
              migrationType: "cold",
              vmxPath: posixVmxPath,
              esxiHost: esxiHostname,
            }, tenantId)
            return
          }
        }
        // Not routed to v2v (non-Windows, missing key auth, or VMX resolution failed) →
        // fall through to the in-house direct-ESXi pipeline.
        await runMigrationPipeline(job.id, migrationConfig, tenantId)
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
