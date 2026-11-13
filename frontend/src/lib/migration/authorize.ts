// Who may land a migration on a cluster (#317). Shared by the creation route
// and the retry route: a retry replays a job's saved target and NICs, so it
// must pass the same checks as the request that created the job, for the
// user who retries it now.

import { NextResponse } from "next/server"

import { checkPermission, getCurrentRbacInfraScope, PERMISSIONS, type RbacInfraScope } from "@/lib/rbac"
import { sensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import type { MigrationNetworkMapEntry, MigrationNicMapping } from "@/lib/migration/target-overrides"

export interface MigrationTargetRequest {
  tenantId: string
  sourceConnectionId: string
  targetConnectionId: string
  targetNode: string
  targetVmid?: number
  networkBridge: string
  vlanTag?: number
  nics?: MigrationNicMapping[]
  /** Bulk network table (ui#1333): its VLAN tags need the same right as a per-NIC tag. */
  networkMap?: MigrationNetworkMapEntry[]
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
 * - vm.migrate must be held on the source connection and on the target node
 *   (see denyMigrationEnds).
 * - Every NIC the job creates (net0 and each per-NIC mapping) needs the VLAN
 *   and MAC permissions a tenant user would need to set it by hand.
 */
export async function authorizeMigrationTarget(r: MigrationTargetRequest): Promise<Response | null> {
  if (!canMigrateConnections(await getTenantInfrastructureScope(r.tenantId), r.sourceConnectionId, r.targetConnectionId)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  const deniedEnds = await denyMigrationEnds(r.sourceConnectionId, r.targetConnectionId, [r.targetNode])
  if (deniedEnds) return deniedEnds
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

/**
 * Null when the caller may run a migration's checks or setup on a target
 * node (the preflight, "Prepare this node"), else the response to return.
 * Both routes run commands on the node with the provider's credentials, so
 * they share this gate rather than each keeping a copy of it:
 * - the tenant must be one that may migrate to the target cluster (and from
 *   the source, when one is named): a vDC tenant never, an MSP only on its
 *   own connections; 404 so nothing is learnt about other connections;
 * - then vm.migrate on the source connection and on the target node.
 */
export async function authorizeMigrationNode(r: { tenantId: string; targetConnectionId: string; targetNode: string; sourceConnectionId?: string }): Promise<Response | null> {
  const ends = r.sourceConnectionId ? [r.sourceConnectionId] : []
  if (!canMigrateConnections(await getTenantInfrastructureScope(r.tenantId), r.targetConnectionId, ...ends)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return denyMigrationEnds(r.sourceConnectionId, r.targetConnectionId, [r.targetNode])
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
export function migrationNicPermissions(r: Pick<MigrationTargetRequest, "tenantId" | "targetConnectionId" | "targetNode" | "targetVmid" | "networkBridge" | "vlanTag" | "nics" | "networkMap">): PermissionNeed[] {
  if (r.tenantId === "default") return []
  const requestedNets: Record<string, string> = { net0: `virtio,bridge=${r.networkBridge}${r.vlanTag ? `,tag=${r.vlanTag}` : ""}` }
  for (const n of r.nics ?? []) {
    const tag = n.vlanTag ?? r.vlanTag
    // A custom MAC (ui#1330) is a MAC the operator sets: vm.config.nic.mac.
    const mac = n.macMode === "custom" && n.mac ? `,macaddr=${n.mac}` : ""
    requestedNets[`net${n.index}`] = `virtio,bridge=${n.bridge}${mac}${tag ? `,tag=${tag}` : ""}`
  }
  // The table's rows land on NICs whose position is only known once the
  // source is read: checked under keys past the NIC range (net32 and up).
  for (const [i, row] of (r.networkMap ?? []).entries()) {
    const tag = row.vlanTag ?? r.vlanTag
    requestedNets[`net${32 + i}`] = `virtio,bridge=${row.bridge}${tag ? `,tag=${tag}` : ""}`
  }
  const onVm = r.targetVmid !== undefined
  return sensitiveNicPermissions(requestedNets).map(permission => ({
    permission,
    resourceType: onVm ? "vm" : "connection",
    resourceId: onVm ? `${r.targetConnectionId}:${r.targetNode}:qemu:${r.targetVmid}` : r.targetConnectionId,
  }))
}

/**
 * Null when the caller holds vm.migrate on both ends of a migration: the
 * source connection (absent for the checks that only touch the target) and
 * every target node, a grant on the whole target connection covering them
 * all. The routes check vm.migrate without a resource first, which a grant
 * scoped to any other cluster satisfies; this is the check on the resources.
 */
export async function denyMigrationEnds(sourceConnectionId: string | undefined, targetConnectionId: string, targetNodes: readonly string[]): Promise<Response | null> {
  if (sourceConnectionId) {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "connection", sourceConnectionId)
    if (denied) return denied
  }
  for (const node of new Set(targetNodes)) {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "node", `${targetConnectionId}:${node}`)
    if (denied) return denied
  }
  return null
}

/** The caller's vm.migrate perimeter, null when unrestricted. */
export function migrateScope(): Promise<RbacInfraScope | null> {
  return getCurrentRbacInfraScope(PERMISSIONS.VM_MIGRATE)
}

/**
 * `where` narrowed to the migration jobs the caller may see and steer: the
 * same two ends as denyMigrationEnds, read from the job. Returned as is when
 * the scope is unrestricted, so the tenant filter alone applies.
 */
export function scopedJobWhere<W extends object>(where: W, scope: RbacInfraScope | null): W | { AND: object[] } {
  if (!scope) return where
  const full = [...scope.fullConnections]
  const nodeGrants = scope.nodeGrantsByConnection ?? scope.nodesByConnection
  return {
    AND: [where, {
      sourceConnectionId: { in: full },
      OR: [
        { targetConnectionId: { in: full } },
        ...[...nodeGrants].map(([connectionId, nodes]) => ({ targetConnectionId: connectionId, targetNode: { in: [...nodes] } })),
      ],
    }],
  }
}

/** Whether the caller may steer a bulk migration: vm.migrate on both whole clusters. */
export function mayMigrateBetweenClusters(scope: RbacInfraScope | null, sourceConnectionId: string, targetConnectionId: string): boolean {
  return !scope || (scope.fullConnections.has(sourceConnectionId) && scope.fullConnections.has(targetConnectionId))
}
