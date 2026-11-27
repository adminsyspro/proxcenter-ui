import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { refreshCachedGuests } from "@/lib/cache/guestSetRefresh"
import { forgetCachedGuest } from "@/lib/cache/inventoryCache"
import { executeHandover, type HandoverErrorCode } from "@/lib/migration/sharedHandover/handover"
import { guardHandoverRequest, nodeSsh, sshReady } from "@/lib/migration/sharedHandover/server"
import { assertBridgeName } from "@/lib/ssh/validate"

export const runtime = "nodejs"

/** Refusals made before anything changed: the caller can fix them and retry. */
const CONFLICTS = new Set<HandoverErrorCode>([
  'GUEST_RUNNING', 'HA_MANAGED', 'REPLICATED', 'VMID_TAKEN', 'NOT_PORTABLE', 'STORAGE_NOT_SHARED', 'CONF_CHANGED', 'TARGET_WRITE_FAILED',
])

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate/handover
 *
 * Moves a stopped guest to another cluster without copying its disks
 * (ui#1460): every disk sits on a storage the target cluster is proven to
 * reach, so only the configuration file (and the firewall rules) change
 * cluster. The guest keeps its VMID. SSH must be on for both connections.
 *
 * Body: { targetConnectionId, targetNode, targetBridge, start? }
 *
 * `data` is the UPID of the start task on the target cluster (`task` says
 * where to follow it), null when the guest was left stopped.
 */
async function handler(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> },
) {
  try {
    const guard = await guardHandoverRequest(await req.json().catch(() => null), ctx)
    if (guard.ok !== true) return guard.response
    const { id, type, node, vmid, targetConnectionId, targetNode, sourceConn, targetConn, body } = guard.request

    let bridge: string
    try {
      bridge = assertBridgeName(body.targetBridge)
    } catch {
      return NextResponse.json({ error: "Invalid targetBridge" }, { status: 400 })
    }

    const [sourceSsh, targetSsh] = await Promise.all([sshReady(id), sshReady(targetConnectionId)])
    if (!sourceSsh || !targetSsh) {
      return NextResponse.json(
        { error: 'The move without copy writes the guest configuration over SSH: enable SSH on both connections', code: 'SSH_REQUIRED', context: { source: String(sourceSsh), target: String(targetSsh) } },
        { status: 409 },
      )
    }

    const outcome = await executeHandover({
      type,
      vmid,
      bridge,
      start: body.start === true,
      source: { conn: sourceConn, node, ssh: await nodeSsh(sourceConn, node) },
      target: { conn: targetConn, node: targetNode, ssh: await nodeSsh(targetConn, targetNode) },
    })

    if (outcome.ok !== true) {
      return NextResponse.json(
        { error: outcome.message, code: outcome.code, context: outcome.context, manual: outcome.manual, storages: outcome.proofs },
        { status: CONFLICTS.has(outcome.code) ? 409 : 500 },
      )
    }

    forgetCachedGuest(id, type, vmid)
    await refreshCachedGuests(targetConnectionId, targetConn, { type, vmid })

    await audit({
      action: "migrate",
      category: "vms",
      resourceType: type,
      resourceId: vmid,
      details: {
        mode: "shared-storage",
        sourceNode: node,
        targetNode,
        targetCluster: targetConn.name,
        connectionId: id,
        storages: outcome.storages,
        firewall: outcome.firewall,
        archive: outcome.archive,
        started: !!outcome.startUpid,
        ...(outcome.startError ? { startError: outcome.startError } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      data: outcome.startUpid,
      task: { connectionId: targetConnectionId, node: targetNode },
      handover: outcome,
    })
  } catch (e: any) {
    console.error('[remote-migrate/handover] Error:', String(e?.message || e).replace(/[\r\n]/g, ' '))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "vms", resourceType: "guest", resourceTypeParam: "type", resourceParam: "vmid", action: "migrate" }, withPublicApiGuard("vm-remote-migrate-handover", handler))
