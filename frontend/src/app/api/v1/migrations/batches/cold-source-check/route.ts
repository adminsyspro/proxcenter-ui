import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyMigrationEnds } from "@/lib/migration/authorize"
import { getCurrentTenantId, getTenantPrisma } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { checkColdBatchSourceReach } from "@/lib/migration/cold-source-reach"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

export const runtime = "nodejs"

const NODE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/

/**
 * POST /api/v1/migrations/batches/cold-source-check
 * Can each target node reach the address a cold vCenter batch downloads the
 * disks from (lib/migration/cold-source-reach)? One test export lease per
 * source host, aborted at once, then one probe session per node. Body:
 * { sourceConnectionId, targetConnectionId, nodes: [...], vms: [{ sourceVmId, sourceVmName }] }.
 * Answers { data: { problems, unchecked, errors } }.
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied
    const body = await req.json().catch(() => null)
    const { sourceConnectionId, targetConnectionId } = body ?? {}
    const nodes: unknown[] = Array.isArray(body?.nodes) ? body.nodes : []
    const vms: Array<Record<string, unknown>> = Array.isArray(body?.vms) ? body.vms : []
    if (typeof sourceConnectionId !== "string" || !sourceConnectionId || typeof targetConnectionId !== "string" || !targetConnectionId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (nodes.length === 0 || nodes.length > 64 || nodes.some(n => typeof n !== "string" || !NODE_NAME_RE.test(n))) {
      return NextResponse.json({ error: "nodes must list between 1 and 64 node names" }, { status: 400 })
    }
    if (vms.length === 0 || vms.length > 500 || vms.some(vm => !isValidSourceVmId(vm?.sourceVmId))) {
      return NextResponse.json({ error: "vms must list between 1 and 500 VMs" }, { status: 400 })
    }
    const tenantId = await getCurrentTenantId()
    if (!canMigrateConnections(await getTenantInfrastructureScope(tenantId), sourceConnectionId, targetConnectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    // The check opens a session on the source and runs a probe on the target
    // nodes with the credentials stored on both: the caller must be allowed to
    // view each of them, as for the copy-check and space-check routes.
    for (const id of [sourceConnectionId, targetConnectionId]) {
      const deniedView = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
      if (deniedView) return deniedView
    }
    const deniedEnds = await denyMigrationEnds(sourceConnectionId, targetConnectionId, nodes as string[])
    if (deniedEnds) return deniedEnds
    const data = await checkColdBatchSourceReach({
      prisma: getTenantPrisma(tenantId),
      sourceConnectionId,
      targetConnectionId,
      vms: vms.map(vm => ({ sourceVmId: vm.sourceVmId as string, name: String(vm.sourceVmName || vm.sourceVmId) })),
      nodes: nodes as string[],
    })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
