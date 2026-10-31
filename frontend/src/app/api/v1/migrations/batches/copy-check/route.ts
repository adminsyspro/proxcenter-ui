import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyMigrationEnds } from "@/lib/migration/authorize"
import { getCurrentTenantId } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { checkBatchCopyNetwork } from "@/lib/migration/batch-copy-reach"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

export const runtime = "nodejs"

const NODE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/

/**
 * POST /api/v1/migrations/batches/copy-check
 * Which target nodes reach the copy network of each VM of a warm VMware batch
 * (roadmap#53), and where each VM goes. Body: { sourceConnectionId,
 * targetConnectionId, copyVmk?, nodes: [...], auto, vms: [{ sourceVmId, sourceVmName }] }.
 * `auto`: VMs are placed on the nodes that reach them; otherwise `nodes[0]`
 * takes every VM. Answers { data: { assignment, problems, infos, unchecked } }.
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied
    const body = await req.json().catch(() => null)
    const { sourceConnectionId, targetConnectionId, copyVmk } = body ?? {}
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
    if (copyVmk !== undefined && copyVmk !== null && copyVmk !== "" && (typeof copyVmk !== "string" || !/^vmk\d{1,3}$/.test(copyVmk))) {
      return NextResponse.json({ error: 'copyVmk must be a VMkernel device ("vmk0")' }, { status: 400 })
    }
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
    const deniedEnds = await denyMigrationEnds(sourceConnectionId, targetConnectionId, nodes as string[])
    if (deniedEnds) return deniedEnds
    const plan = await checkBatchCopyNetwork({
      tenantId, sourceConnectionId, targetConnectionId,
      pinnedDevice: typeof copyVmk === "string" && copyVmk ? copyVmk : undefined,
      vms: vms.map(vm => ({ sourceVmId: vm.sourceVmId as string, name: String(vm.sourceVmName || vm.sourceVmId) })),
      candidates: nodes as string[],
      auto: body.auto === true,
    })
    return NextResponse.json({ data: plan })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
