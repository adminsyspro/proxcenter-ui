import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { runV2vPreflight, installV2vPackages, startVirtioWinDownload, checkVirtioWinProgress } from "@/lib/migration/v2v-preflight"
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { runXcpngWarmNodePreflight } from "@/lib/migration/warm/xcpng-node-preflight"
import { isVddkPackageTokenConfigured } from "@/lib/migration/warm/vddk-provision"
import { prisma } from "@/lib/db/prisma"
import { safeLog } from "@/lib/log/sanitize"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied

  let body: {
    sourceConnectionId?: string
    targetConnectionId?: string
    targetNode?: string
    requiredDiskBytes?: number
    action?: string
    vmName?: string
    sourceType?: string
    vddkLibdir?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sourceConnectionId, targetConnectionId, targetNode, requiredDiskBytes, action, vmName, sourceType, vddkLibdir } = body

  if (!targetConnectionId || !targetNode) {
    return NextResponse.json(
      { error: "Missing required fields: targetConnectionId, targetNode" },
      { status: 400 }
    )
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
    if (action === "warm-check") {
      const sourceConn = sourceConnectionId
        ? await prisma.connection.findUnique({ where: { id: sourceConnectionId }, select: { type: true } })
        : null
      if (sourceConn?.type === "xcpng") {
        const nbdResult = await runXcpngWarmNodePreflight(targetConnectionId, targetNode)
        return NextResponse.json({ ...nbdResult, kind: "nbd", vddkTokenConfigured: false })
      }
      const result = await runWarmNodePreflight(targetConnectionId, targetNode, vddkLibdir)
      return NextResponse.json({ ...result, kind: "vddk", vddkTokenConfigured: isVddkPackageTokenConfigured() })
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
