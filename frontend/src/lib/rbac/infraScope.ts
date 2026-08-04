/**
 * Pure, dependency-free RBAC infrastructure-scope helpers for the inventory /
 * topology TREE. Derived from a user's grants and applied at the same
 * chokepoints as the tenant/vDC mask, COMPOSED with it (intersection).
 *
 * connection/node/vm scopes name infrastructure directly, so they define the
 * perimeter up front. tag/pool scopes are resource-flat: the guests they match
 * are only known after the per-guest RBAC filter has run, so such a scope is
 * flagged `guestDerived` and its perimeter is computed from the guests that
 * survive that filter (issue #633). The tree and hosts view modes plus the
 * Topology page stay hidden for those users through hasInfraScope(); only the
 * flat vms / tags / pools views consume this data.
 */

export type RbacInfraScope = {
  /** Connections granted whole (connection scope) -> ALL their nodes are visible. */
  fullConnections: Set<string>
  /** Per-connection node names granted (node / vm scope) -> only those nodes. */
  nodesByConnection: Map<string, Set<string>>
  /**
   * True when the user holds a tag or pool grant. The perimeter is then whatever
   * still hosts a visible guest, unioned with the sets above. Never true for a
   * token principal.
   */
  guestDerived: boolean
}

const TREE_SCOPE_TYPES = new Set(['connection', 'node', 'vm'])
const FLAT_SCOPE_TYPES = new Set(['tag', 'pool'])

/**
 * Build the tree mask from loaded grants. Returns null when the user is
 * unrestricted (super admin or holds a `global` scope); callers must then skip
 * RBAC tree pruning. A non-null scope with empty sets and `guestDerived: false`
 * restricts the tree to nothing (no infra and no flat grants).
 */
export function deriveRbacInfraScope(grants: {
  superAdmin: boolean
  byScope: ReadonlyArray<{ scopeType: string; scopeTarget: string | null }>
}): RbacInfraScope | null {
  if (grants.superAdmin) return null
  if (grants.byScope.some(g => g.scopeType === 'global')) return null

  const fullConnections = new Set<string>()
  const nodesByConnection = new Map<string, Set<string>>()
  let guestDerived = false

  for (const g of grants.byScope) {
    if (FLAT_SCOPE_TYPES.has(g.scopeType) && g.scopeTarget) {
      guestDerived = true
      continue
    }
    if (!TREE_SCOPE_TYPES.has(g.scopeType) || !g.scopeTarget) continue
    const parts = g.scopeTarget.split(':')
    const connId = parts[0]
    if (!connId) continue
    if (g.scopeType === 'connection') {
      fullConnections.add(connId)
      continue
    }
    // node => connId:nodeName ; vm => connId:nodeName:type:vmid
    const nodeName = parts[1]
    if (!nodeName) continue
    let set = nodesByConnection.get(connId)
    if (!set) {
      set = new Set<string>()
      nodesByConnection.set(connId, set)
    }
    set.add(nodeName)
  }

  return { fullConnections, nodesByConnection, guestDerived }
}

/** Whether a whole connection is granted outright (infra scopes only). */
export function isConnectionVisible(scope: RbacInfraScope, connId: string): boolean {
  return scope.fullConnections.has(connId) || scope.nodesByConnection.has(connId)
}

/**
 * Whether a connection may still hold something the user can see. True for an
 * outright grant, and true on a guest-derived scope for ANY connection, because
 * only the per-guest filter can answer. Use this to decide what to fetch or
 * subscribe to, never as the final visibility answer.
 */
export function mayHaveVisibleGuests(scope: RbacInfraScope, connId: string): boolean {
  return scope.guestDerived || isConnectionVisible(scope, connId)
}

/**
 * Keep only items whose id is granted outright. Null scope = no pruning.
 * Strict on purpose: used for PBS servers, external hypervisors and the
 * connections list, none of which a tag/pool-only user has business listing.
 */
export function filterVisibleConnections<T extends { id: string }>(
  list: T[],
  scope: RbacInfraScope | null,
): T[] {
  if (scope === null) return list
  return list.filter(item => isConnectionVisible(scope, item.id))
}

/**
 * Candidate set for the guest-bearing tree: keeps outright grants, and keeps
 * everything when the scope is guest-derived. Callers MUST follow up with
 * applyRbacInfraFilter + pruneEmptyConnections once guests are filtered.
 */
export function filterCandidateConnections<T extends { id: string }>(
  list: T[],
  scope: RbacInfraScope | null,
): T[] {
  if (scope === null) return list
  return list.filter(item => mayHaveVisibleGuests(scope, item.id))
}

/**
 * Prune a cluster's NODES by the RBAC scope. Guests are left untouched; the
 * caller already filtered them via filterVmsByPermission. A full-connection
 * grant keeps every node; otherwise we keep the granted nodes unioned with the
 * nodes that still host a visible guest when the scope is guest-derived. A
 * non-visible connection on a non-guest-derived scope is emptied.
 */
export function applyRbacInfraFilter<
  C extends { id: string; nodes: Array<{ node: string; guests?: ReadonlyArray<unknown> }> },
>(cluster: C, scope: RbacInfraScope | null): C {
  if (scope === null) return cluster
  const connId = cluster.id
  if (scope.fullConnections.has(connId)) return cluster
  const allowed = scope.nodesByConnection.get(connId)
  if (!scope.guestDerived) {
    if (!allowed) return { ...cluster, nodes: [] }
    return { ...cluster, nodes: cluster.nodes.filter(n => allowed.has(n.node)) }
  }
  return {
    ...cluster,
    nodes: cluster.nodes.filter(n => (allowed && allowed.has(n.node)) || (n.guests?.length ?? 0) > 0),
  }
}

/**
 * Drop connections that ended up with no node at all, unless they were granted
 * outright (an admin-granted connection legitimately shows up empty). Run this
 * after applyRbacInfraFilter so a guest-derived user never sees a bare shell.
 */
export function pruneEmptyConnections<C extends { id: string; nodes: ReadonlyArray<unknown> }>(
  clusters: C[],
  scope: RbacInfraScope | null,
): C[] {
  if (scope === null) return clusters
  return clusters.filter(c => c.nodes.length > 0 || isConnectionVisible(scope, c.id))
}

/**
 * Tree mask for a token principal (spec section 6). connectionIds null =
 * unrestricted within the tenant (the tenant mask still applies upstream).
 * Exact-set semantics: no prefix matching, conn-1 never covers conn-10.
 * Tokens carry no tag/pool grants, so the mask is never guest-derived.
 */
export function tokenInfraScope(connectionIds: string[] | null): RbacInfraScope | null {
  if (connectionIds === null) return null
  return { fullConnections: new Set(connectionIds), nodesByConnection: new Map(), guestDerived: false }
}
