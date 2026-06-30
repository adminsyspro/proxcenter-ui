/**
 * Pure, dependency-free RBAC infrastructure-scope helpers for the inventory /
 * topology TREE. Derived from a user's grants and applied at the same
 * chokepoints as the tenant/vDC mask, COMPOSED with it (intersection).
 *
 * Only connection/node/vm scopes describe infrastructure the user may see in
 * the tree. tag/pool scopes are resource-flat (Decision 2, 2026-06-30): they
 * never widen the tree, so a tag/pool-only user gets an empty tree.
 */

export type RbacInfraScope = {
  /** Connections granted whole (connection scope) -> ALL their nodes are visible. */
  fullConnections: Set<string>
  /** Per-connection node names granted (node / vm scope) -> only those nodes. */
  nodesByConnection: Map<string, Set<string>>
}

const TREE_SCOPE_TYPES = new Set(['connection', 'node', 'vm'])

/**
 * Build the tree mask from loaded grants. Returns null when the user is
 * unrestricted (super admin or holds a `global` scope); callers must then skip
 * RBAC tree pruning. A non-null scope with empty sets restricts the tree to
 * nothing (tag/pool-only or no infra grants).
 */
export function deriveRbacInfraScope(grants: {
  superAdmin: boolean
  byScope: ReadonlyArray<{ scopeType: string; scopeTarget: string | null }>
}): RbacInfraScope | null {
  if (grants.superAdmin) return null
  if (grants.byScope.some(g => g.scopeType === 'global')) return null

  const fullConnections = new Set<string>()
  const nodesByConnection = new Map<string, Set<string>>()

  for (const g of grants.byScope) {
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

  return { fullConnections, nodesByConnection }
}

/** Whether a whole connection should appear in the tree at all. */
export function isConnectionVisible(scope: RbacInfraScope, connId: string): boolean {
  return scope.fullConnections.has(connId) || scope.nodesByConnection.has(connId)
}

/**
 * Keep only items whose id is visible in the scope. Null scope = no pruning.
 * Covers clusters, pbsServers, and externalHypervisors (all have an `id` that
 * maps to the connection id).
 */
export function filterVisibleConnections<T extends { id: string }>(
  list: T[],
  scope: RbacInfraScope | null,
): T[] {
  if (scope === null) return list
  return list.filter(item => isConnectionVisible(scope, item.id))
}

/**
 * Prune a cluster's NODES by the RBAC scope. Guests are left untouched; the
 * caller already filtered them via filterVmsByPermission. A full-connection
 * grant keeps every node; a node grant keeps only listed nodes; a non-visible
 * connection is emptied (callers drop it at the connection step).
 */
export function applyRbacInfraFilter<C extends { id: string; nodes: Array<{ node: string }> }>(
  cluster: C,
  scope: RbacInfraScope | null,
): C {
  if (scope === null) return cluster
  const connId = cluster.id
  if (scope.fullConnections.has(connId)) return cluster
  const allowed = scope.nodesByConnection.get(connId)
  if (!allowed) return { ...cluster, nodes: [] }
  return { ...cluster, nodes: cluster.nodes.filter(n => allowed.has(n.node)) }
}
