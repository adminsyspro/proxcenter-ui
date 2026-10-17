// Who may land a migration on a cluster (#317). Shared by the creation route
// and the retry route: a retry replays a job's saved target and NICs, so it
// must pass the same checks as the request that created the job, for the
// user who retries it now.

import { NextResponse } from "next/server"

import { checkPermission } from "@/lib/rbac"
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
  if (r.tenantId === "default") return null

  const requestedNets: Record<string, string> = { net0: `virtio,bridge=${r.networkBridge}${r.vlanTag ? `,tag=${r.vlanTag}` : ""}` }
  for (const n of r.nics ?? []) {
    const tag = n.vlanTag ?? r.vlanTag
    requestedNets[`net${n.index}`] = `virtio,bridge=${n.bridge}${tag ? `,tag=${tag}` : ""}`
  }
  for (const permission of sensitiveNicPermissions(requestedNets)) {
    const denied = await checkPermission(permission,
      r.targetVmid === undefined ? "connection" : "vm",
      r.targetVmid === undefined ? r.targetConnectionId : `${r.targetConnectionId}:${r.targetNode}:qemu:${r.targetVmid}`)
    if (denied) return denied
  }
  return null
}
