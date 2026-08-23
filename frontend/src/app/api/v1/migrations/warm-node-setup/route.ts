import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { provisionWarmNode } from "@/lib/migration/warm/vddk-provision"
import { safeLog } from "@/lib/log/sanitize"

export const runtime = "nodejs"

/**
 * Automated warm-migration node provisioning: install the VDDK runtime
 * (nbdkit + vddk plugin + nbd-client + the VDDK from the private Enterprise
 * GHCR package + the nbd kernel module) on the target Proxmox node, then
 * return the post-provision preflight verdict — the same shape the dialog's
 * warm-check already consumes. Sibling of /api/v1/migrations/preflight and
 * gated the same way, plus the vmware_migration feature (the VDDK package is
 * an Enterprise deliverable).
 */
export async function POST(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied

  const guard = await requireFeature(Features.VMWARE_MIGRATION)
  if (guard) return guard

  let body: {
    targetConnectionId?: string
    targetNode?: string
    vddkLibdir?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { targetConnectionId, targetNode, vddkLibdir } = body

  if (!targetConnectionId || !targetNode) {
    return NextResponse.json(
      { error: "Missing required fields: targetConnectionId, targetNode" },
      { status: 400 }
    )
  }

  try {
    const result = await provisionWarmNode(targetConnectionId, targetNode, vddkLibdir)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    // targetNode and vddkLibdir reach this message, so the log line carries a
    // user-provided value. safeLog already strips CR/LF and control characters,
    // but code scanning does not see through it, hence the explicit inline
    // strip used by the other routes in this API.
    console.error("[migrations/warm-node-setup] Error:", safeLog(message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
