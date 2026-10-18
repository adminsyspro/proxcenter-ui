// Who may land a migration on a cluster (#317). Shared by the creation route
// and the retry route: a retry replays a job's saved target and NICs, so it
// must pass the same checks as the request that created the job, for the
// user who retries it now.

import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { sensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import type { MigrationNicMapping } from "@/lib/migration/target-overrides"

export interface MigrationTargetRequest {
  tenantId: string
  sourceConnectionId: string
  targetConnectionId: string
  targetNode: string
  targetVmid?: number
  networkBridge: string
  vlanTag?: number
  nics?: MigrationNicMapping[]
  /**
   * The VMkernel adapter the copy is pinned to (roadmap#53). On a vCenter
   * source it is applied by moving the vSphereBackupNFC tag on the HOST, a
   * host-wide network setting (backup products follow it too): it needs the
   * right to manage the source connection, not only to migrate.
   */
  copyVmk?: string
}

/**
 * Null when the caller may run this migration, else the response to return.
 * - A migration lands guests on whole clusters (any bridge, VNet or storage
 *   of the target): only a tenant owning BOTH clusters may run it, as for a
 *   remote migration. A vDC tenant never does, an MSP only between its own
 *   clusters; 404 so nothing is learnt about other connections.
 * - Every NIC the job creates (net0 and each per-NIC mapping) needs the VLAN
 *   and MAC permissions a tenant user would need to set it by hand.
 */
export async function authorizeMigrationTarget(r: MigrationTargetRequest): Promise<Response | null> {
  if (!canMigrateConnections(await getTenantInfrastructureScope(r.tenantId), r.sourceConnectionId, r.targetConnectionId)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  if (r.copyVmk) {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", r.sourceConnectionId)
    if (denied) return denied
  }
  for (const need of migrationNicPermissions(r)) {
    const denied = await checkPermission(need.permission, need.resourceType, need.resourceId)
    if (denied) return denied
  }
  return null
}

export interface PermissionNeed {
  permission: string
  resourceType: "connection" | "vm"
  resourceId: string
}

/**
 * The VLAN and MAC permissions the NICs of a migration need (net0 and each
 * per-NIC mapping), as a tenant user would need them to set those NICs by
 * hand; none in the provider tenant. Shared by the routes, which check them
 * on the session, and the batch scheduler, which checks them for the batch
 * creator before a queued job starts.
 */
export function migrationNicPermissions(r: Pick<MigrationTargetRequest, "tenantId" | "targetConnectionId" | "targetNode" | "targetVmid" | "networkBridge" | "vlanTag" | "nics">): PermissionNeed[] {
  if (r.tenantId === "default") return []
  const requestedNets: Record<string, string> = { net0: `virtio,bridge=${r.networkBridge}${r.vlanTag ? `,tag=${r.vlanTag}` : ""}` }
  for (const n of r.nics ?? []) {
    const tag = n.vlanTag ?? r.vlanTag
    requestedNets[`net${n.index}`] = `virtio,bridge=${n.bridge}${tag ? `,tag=${tag}` : ""}`
  }
  const onVm = r.targetVmid !== undefined
  return sensitiveNicPermissions(requestedNets).map(permission => ({
    permission,
    resourceType: onVm ? "vm" : "connection",
    resourceId: onVm ? `${r.targetConnectionId}:${r.targetNode}:qemu:${r.targetVmid}` : r.targetConnectionId,
  }))
}
