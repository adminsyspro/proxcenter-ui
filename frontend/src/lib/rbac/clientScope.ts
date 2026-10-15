/**
 * Client-side mirror of the server's scope matching, over the grant details
 * `/api/v1/rbac/effective` returns (issue #921).
 *
 * Kept dependency-free (no prisma / server imports) so the RBAC context can
 * answer "may this user do X on THIS storage" without a round trip per
 * resource: a storage browser lists many storages and must hide the write
 * controls on the ones the route would refuse.
 *
 * Only infrastructure-shaped resources are matched here (connection, node,
 * vm, storage). Tag and pool grants need the guest's metadata, which the
 * server resolves at access time, so they never match a resource on the
 * client: callers gating a guest action keep using the flat `hasPermission`.
 */

import { SENSITIVE_NIC_PERMISSIONS } from './nicPermissions'

export type GrantDetail = {
  name: string
  scope_type: string
  scope_target?: string | null
}

export type ClientResourceType = 'connection' | 'node' | 'vm' | 'storage' | 'pbs'

/** Same hierarchy as the server: a parent right covers its ordinary children. */
function nameCovers(granted: string, requested: string): boolean {
  if (granted === requested) return true
  if ((SENSITIVE_NIC_PERMISSIONS as readonly string[]).includes(requested)) return false
  return requested.startsWith(`${granted}.`) && granted.split('.').length >= 2
}

export function grantCoversResource(
  grant: Pick<GrantDetail, 'scope_type' | 'scope_target'>,
  resourceType: ClientResourceType,
  resourceId: string,
): boolean {
  const target = grant.scope_target ?? null
  switch (grant.scope_type) {
    case 'global':
      return true
    case 'connection':
    case 'node':
      return !!target && (resourceId === target || resourceId.startsWith(`${target}:`))
    case 'vm':
      return resourceType === 'vm' && !!target && resourceId === target
    case 'storage':
      return resourceType === 'storage' && !!target && resourceId === target
    default:
      return false
  }
}

/**
 * True when at least one grant carries `permission` (or a parent of it) on a
 * scope covering the resource.
 */
export function hasGrantOn(
  grants: readonly GrantDetail[] | null | undefined,
  permission: string,
  resourceType: ClientResourceType,
  resourceId: string,
): boolean {
  if (!grants || !resourceId) return false
  return grants.some(g => nameCovers(g.name, permission) && grantCoversResource(g, resourceType, resourceId))
}

/** `connectionId:storageId`, the resource id the storage routes judge on. */
export function storageResourceId(connId: string, storage: string): string {
  return `${connId}:${storage}`
}
