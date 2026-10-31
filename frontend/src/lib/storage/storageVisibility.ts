/**
 * Which storages of a cluster the caller may see.
 *
 * Shared by the storage list route and the assistant's storage tools (#459),
 * so the two cannot disagree: the assistant once listed every storage of the
 * cluster to a vDC tenant and to node- or VM-scoped users, while the route
 * narrowed the very same rows.
 */

import { NextResponse } from 'next/server'

import {
  checkPermission,
  getCurrentRbacInfraScope,
  getRequestGuestScopePerimeter,
  PERMISSIONS,
  type GuestScopePerimeter,
} from '@/lib/rbac'
import { hasInfraGrant, hasStorageGrant, isStorageVisible, type RbacInfraScope } from '@/lib/rbac/infraScope'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

export type StorageCaller = {
  /** The refusal to return when `allowed` is false. */
  denied: NextResponse | null
  allowed: boolean
  perimeter: GuestScopePerimeter | null
  infraScope: RbacInfraScope | null
  partial: boolean
}

/**
 * How the caller reaches this cluster's storages.
 *
 * connection.view (not storage.view) so tenant admins can see the list, then
 * two narrower ways in for callers whose grant never matches the connection:
 * - flat-scoped callers (vm/tag/pool) through the guest-derived perimeter
 *   (issue #262: the Create VM wizard showed an empty Storage dropdown);
 * - node- or storage-scoped callers holding connection.view or storage.view
 *   (issue #921), narrowed by isStorageVisible.
 */
export async function resolveStorageCaller(connId: string): Promise<StorageCaller> {
  const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', connId)
  const perimeter = denied ? await getRequestGuestScopePerimeter(connId) : null
  const infraScope = denied ? await getCurrentRbacInfraScope([PERMISSIONS.CONNECTION_VIEW, PERMISSIONS.STORAGE_VIEW]) : null
  const partial = !!infraScope && (hasInfraGrant(infraScope, connId) || hasStorageGrant(infraScope, connId))
  const allowed = !denied || partial || Boolean(perimeter?.holdsPermission && perimeter.hasVisibleGuests)

  return { denied, allowed, perimeter, infraScope, partial }
}

export type StorageRow = {
  storage: string
  shared?: boolean | number
  type?: string
  node?: string
  /** Every node mounting the storage, on an aggregated row. */
  nodes?: string[] | null
}

function nodesOf(s: StorageRow): string[] {
  if (Array.isArray(s.nodes)) return s.nodes

  return s.node ? [s.node] : []
}

/**
 * The predicate keeping the rows the caller may see, for a caller resolved
 * with `resolveStorageCaller` and allowed in.
 */
export async function storageVisibilityFilter(
  connId: string,
  tenantId: string,
  caller: StorageCaller
): Promise<(row: StorageRow) => boolean> {
  if (!caller.allowed) return () => false

  // iaas (vDC) tenants are masked to their slice; provider and msp see the
  // whole cluster (maskingScope is null for both).
  const vdcScope = maskingScope(await getTenantInfrastructureScope(tenantId))
  const allowedStorages = vdcScope?.storagesByConnection.get(connId)
  const allowedNodes = vdcScope?.nodesByConnection.get(connId)
  const { perimeter, partial, infraScope } = caller

  return (s: StorageRow) => {
    if (vdcScope) {
      if (!allowedStorages || !allowedNodes || !allowedStorages.has(s.storage)) return false

      // A shared pool (ceph, nfs, cifs...) is dropped from tenant views:
      // browsing its content would leak every other tenant's filenames. PBS
      // is the exception, isolated per namespace on the backup routes, and
      // aggregated across nodes, so any reachable node lets it through.
      if (s.type === 'pbs') {
        if (!nodesOf(s).some(n => allowedNodes.has(n))) return false
      } else if (s.shared) {
        return false
      } else if (!s.node || !allowedNodes.has(s.node)) {
        return false
      }
    }

    // A flat-scoped caller gets the shared storages, usable from anywhere on
    // the cluster, plus the local ones of a node hosting one of their guests.
    if (perimeter?.restricted && !s.shared && !nodesOf(s).some(n => perimeter.nodes.has(n))) return false

    if (partial && infraScope) {
      return isStorageVisible(infraScope, connId, {
        storage: s.storage,
        shared: !!s.shared,
        node: s.node,
        nodes: Array.isArray(s.nodes) ? s.nodes : null,
      })
    }

    return true
  }
}
