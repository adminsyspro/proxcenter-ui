import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyMigrationEnds } from "@/lib/migration/authorize"
import { getCurrentTenantId } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { assertStorageName } from "@/lib/ssh/validate"
import { checkBatchSpaceForRequest, requestDiskBytes } from "@/lib/migration/batch-space"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

export const runtime = "nodejs"

const NODE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/

/**
 * POST /api/v1/migrations/batches/space-check
 * Whether the target storage holds a whole bulk migration (roadmap#53), as
 * POST /api/v1/migrations/batches will check it. Body: { sourceConnectionId,
 * targetConnectionId, targetStorage, vms: [{ sourceVmId, targetNode, diskBytes }] }
 * (diskBytes = the list's estimate, used when the exact size cannot be read).
 * Answers { data: { ok, problems, warnings } }, each entry { storage, node,
 * availableBytes, requiredBytes, error?, estimated?, message }.
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied
    const body = await req.json().catch(() => null)
    const { sourceConnectionId, targetConnectionId, targetStorage } = body ?? {}
    const vms: Array<Record<string, unknown>> = Array.isArray(body?.vms) ? body.vms : []
    if (typeof targetConnectionId !== "string" || !targetConnectionId || typeof sourceConnectionId !== "string" || !sourceConnectionId || vms.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    try { assertStorageName(targetStorage) } catch { return NextResponse.json({ error: "Invalid targetStorage" }, { status: 400 }) }
    if (vms.length > 500 || vms.some(vm => typeof vm?.targetNode !== "string" || !NODE_NAME_RE.test(vm.targetNode) || !isValidSourceVmId(vm?.sourceVmId))) {
      return NextResponse.json({ error: "Each VM needs a sourceVmId and a valid targetNode" }, { status: 400 })
    }
    // Same perimeter as the batch itself: nothing about another tenant's cluster.
    const tenantId = await getCurrentTenantId()
    if (!canMigrateConnections(await getTenantInfrastructureScope(tenantId), sourceConnectionId, targetConnectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    // The check reads the source's VMs and the target's storage or nodes with
    // the credentials stored on both connections: the caller must be allowed
    // to view each of them, as for the single VM preflight and the batch itself.
    for (const id of [sourceConnectionId, targetConnectionId]) {
      const deniedView = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
      if (deniedView) return deniedView
    }
    const deniedEnds = await denyMigrationEnds(sourceConnectionId, targetConnectionId, vms.map(vm => vm.targetNode as string))
    if (deniedEnds) return deniedEnds
    const result = await checkBatchSpaceForRequest({
      tenantId, sourceConnectionId, targetConnectionId, storage: targetStorage,
      vms: vms.map(vm => ({ sourceVmId: String(vm.sourceVmId ?? ""), targetNode: vm.targetNode as string, estimatedBytes: requestDiskBytes(vm.diskBytes) })),
    })
    return NextResponse.json({ data: result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
