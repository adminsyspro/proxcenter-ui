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
