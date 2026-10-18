import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { runV2vPreflight, installV2vPackages, startVirtioWinDownload, checkVirtioWinProgress } from "@/lib/migration/v2v-preflight"
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { runXcpngWarmNodePreflight } from "@/lib/migration/warm/xcpng-node-preflight"
import { isVddkPackageTokenConfigured } from "@/lib/migration/warm/vddk-provision"
import { checkTargetStorageSpace } from "@/lib/migration/warm/target-space"
import { checkWarmSourceVersion, fetchSourceApiVersion, warmSourceVersionError, warmSourceVersionWarning } from "@/lib/migration/warm/source-version"
import { runWarmCopyReachability } from "@/lib/migration/warm/nfc-reachability"
import { readVmCopyInterfaces } from "@/lib/vmware/copy-interfaces-server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { safeLog } from "@/lib/log/sanitize"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied

  let body: {
    sourceConnectionId?: string
    targetConnectionId?: string
    targetNode?: string
    targetStorage?: string
    requiredDiskBytes?: number
    action?: string
    vmName?: string
    sourceType?: string
    vddkLibdir?: string
    /** The source VM and the VMkernel adapter its copy should use (roadmap#53). */
    sourceVmId?: string
    copyVmk?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sourceConnectionId, targetConnectionId, targetNode, targetStorage, requiredDiskBytes, action, vmName, sourceType, vddkLibdir, sourceVmId, copyVmk } = body

  if (!targetConnectionId || !targetNode) {
    return NextResponse.json(
      { error: "Missing required fields: targetConnectionId, targetNode" },
      { status: 400 }
    )
  }

  // The preflight runs commands on the target node and opens sessions on the
  // source with its stored credentials: only for clusters the caller may
  // migrate between, as the migration itself (a vDC tenant never, an MSP only
  // on its own connections). 404 so nothing is learnt about other connections.
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  if (!canMigrateConnections(infra, targetConnectionId, ...(sourceConnectionId ? [sourceConnectionId] : []))) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    if (action === "install") {
      const result = await installV2vPackages(targetConnectionId, targetNode)
      return NextResponse.json(result)
    }

    if (action === "install-virtio-win") {
      const result = await startVirtioWinDownload(targetConnectionId, targetNode)
      return NextResponse.json(result)
    }

    if (action === "check-virtio-win") {
      const result = await checkVirtioWinProgress(targetConnectionId, targetNode)
      return NextResponse.json(result)
    }

    // Warm migration go/no-go: report whether the target node has the VDDK
    // runtime the engine needs, plus whether this server holds the Enterprise
    // VDDK package token — a boolean only, added here in the route layer so
    // the dialog can offer the automated "Prepare this node" action
    // (POST /api/v1/migrations/warm-node-setup) without the token ever
    // reaching the client. Manual node prep stays documented as the fallback.
    //
    // Which runtime is needed depends on the SOURCE: VMware warm reads through
    // nbdkit-vddk, XCP-ng warm re-exports xapi-nbd through nbdkit's nbd plugin,
    // so the two need different probes. The source connection type decides which
    // one runs, and `kind` tells the dialog which one answered. On the nbd path
    // there is nothing to install from the Enterprise repo, so the VDDK token
    // flag is always false there.
    //
    // `space` is the target storage's live free space against the source disks
    // (requiredDiskBytes, the dialog's committed size) plus the 10 % margin the
    // cold engine applies. Only computed when the dialog names a storage; it is
    // independent of the runtime verdict so the dialog can show both.
    if (action === "warm-check") {
      const sourceConn = sourceConnectionId
        ? await prisma.connection.findUnique({ where: { id: sourceConnectionId }, select: { type: true } })
        : null
      if (copyVmk !== undefined && (typeof copyVmk !== "string" || !/^vmk\d{1,3}$/.test(copyVmk) || typeof sourceVmId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sourceVmId) || !sourceConnectionId)) {
        return NextResponse.json({ error: 'copyVmk must be a VMkernel device ("vmk0"), with sourceConnectionId and sourceVmId' }, { status: 400 })
      }
      // Reading the source host's adapters takes the same right as listing them
      // (GET /vmware/[id]/vms/[vmid]/copy-interfaces): viewing that connection.
      if (copyVmk !== undefined) {
        const deniedSource = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", sourceConnectionId!)
        if (deniedSource) return deniedSource
      }
      const space = targetStorage
        ? await checkTargetStorageSpace(targetConnectionId, targetNode, targetStorage, Math.max(0, Number(requiredDiskBytes) || 0))
        : undefined
      if (sourceConn?.type === "xcpng") {
        const nbdResult = await runXcpngWarmNodePreflight(targetConnectionId, targetNode)
        return NextResponse.json({ ...nbdResult, kind: "nbd", vddkTokenConfigured: false, space })
      }
      const result = await runWarmNodePreflight(targetConnectionId, targetNode, vddkLibdir)
      // roadmap#53: can the node reach the VMkernel adapter the copy will use?
      // Probed from the node itself; a vCenter source only needs the NFC data
      // port there, a standalone host also serves the VDDK's API calls at it.
      // Independent of the runtime verdict, like `space`, so the dialog shows both.
      // The address is read from vSphere for the adapter named, never taken from
      // the request: the node only ever probes the source host's own adapters.
      const copy = copyVmk ? await probeCopyAdapter(await getSessionPrisma(), sourceConnectionId!, sourceVmId!, copyVmk, targetConnectionId, targetNode) : undefined
      // #946: the node can be perfectly provisioned and the run still be hopeless,
      // because the VDDK reads the SOURCE and Broadcom supports each generation
      // against its own vSphere release and the two before it. An ESXi 5.5 source
      // used to get all the way to the copy and die on `dd` with an I/O error after
      // zero bytes. A blocking verdict clears `ok`, which is what gates the launch.
      const source = sourceConnectionId
        ? checkWarmSourceVersion({
            sourceApiVersion: await fetchSourceApiVersion(sourceConnectionId),
            vddkLibPath: result.vddkLib,
          })
        : undefined
      return NextResponse.json({
        ...result,
        ok: result.ok && !source?.blocked,
        kind: "vddk",
        vddkTokenConfigured: isVddkPackageTokenConfigured(),
        space,
        ...(copy && { copy }),
        source: source && (source.blocked || source.warning)
          ? { ...source, message: source.blocked ? warmSourceVersionError(source) : warmSourceVersionWarning(source) }
          : undefined,
      })
    }

    const result = await runV2vPreflight(
      targetConnectionId,
      targetNode,
      requiredDiskBytes ?? 0,
      vmName,
      sourceType
    )
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[migrations/preflight] Error:", safeLog(message))
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Reachability of the source host's adapter `device`, at the address vSphere reports for it. */
async function probeCopyAdapter(prisma: any, sourceConnectionId: string, sourceVmId: string, device: string, targetConnectionId: string, targetNode: string) {
  try {
    const ifaces = await readVmCopyInterfaces(prisma, sourceConnectionId, sourceVmId)
    const vnic = ifaces.vnics.find(v => v.device === device)
    if (!vnic?.address) return { address: "", ports: {}, ok: false, error: `VMkernel adapter ${device} has no address on the source host` }
    return await runWarmCopyReachability(targetConnectionId, targetNode, vnic.address, ifaces.source === "esxi")
  } catch (e: any) {
    return { address: "", ports: {}, ok: false, error: String(e?.message || e) }
  }
}
