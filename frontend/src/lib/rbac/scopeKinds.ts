/**
 * Client-safe helpers describing what a user's RBAC scope kinds reveal.
 *
 * Kept dependency-free (no prisma / server imports) so it can be used from
 * client components — the nav menu and the topology page both gate on it.
 */

/**
 * Scope kinds that grant an infrastructure-level view: the user can see
 * cluster / node topology. A role scoped to one of these (or `global`) is a
 * provider-side scope. VM / tag / pool scopes are resource-flat: they reveal
 * individual guests but never the underlying cluster/node layout.
 */
export const INFRA_SCOPE_TYPES = ['global', 'connection', 'node'] as const

/**
 * True when the user may see infrastructure topology, i.e. they are an admin
 * or hold at least one infra-level scope. VM / tag / pool only scopes return
 * false — those users get a flat resource view with no cluster/node topology,
 * so topology-revealing surfaces (the Topology page, inventory tree/hosts)
 * stay hidden for them.
 */
export function hasInfraScope(
  scopeTypes: readonly string[] | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!scopeTypes) return false

  return scopeTypes.some(s => (INFRA_SCOPE_TYPES as readonly string[]).includes(s))
}

/**
 * True when the inventory tree should group nodes under their cluster instead
 * of listing hosts flat at the first level.
 *
 * Two gates, and both matter:
 *  - the tenant one. A vDC (IaaS) tenant never sees the cluster it is carved
 *    out of: hiding the underlying topology IS the abstraction. Provider and
 *    MSP tenants own whole clusters, so they get the grouped view.
 *  - the scope one. Inside those tenants, only an infra-level scope reveals
 *    cluster/node layout; a user scoped to a pool, a tag or single VMs stays on
 *    the flat resource view, same rule the topology page and the widgets apply.
 *
 * Before this, the tree gated on `is_super_admin` alone, which also stripped the
 * cluster level from provider admins, tenant admins and operators on the
 * provider tenant, while the header right above kept counting the clusters they
 * could not see.
 */
export function showsClusterLevel(params: {
  /** Provider or MSP tenant, i.e. not a vDC slice. */
  isFullClusterView: boolean
  scopeTypes: readonly string[] | null | undefined
  isSuperAdmin: boolean
}): boolean {
  // A super-admin keeps the grouped view everywhere, including while browsing a
  // vDC tenant — unchanged from the previous behaviour.
  if (params.isSuperAdmin) return true
  if (!params.isFullClusterView) return false
  return hasInfraScope(params.scopeTypes, false)
}
