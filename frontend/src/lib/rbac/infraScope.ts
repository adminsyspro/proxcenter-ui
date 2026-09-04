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
  /**
   * Per-connection node names the TREE may show: node grants plus the node of
   * every vm grant (a vm-scoped user still sees their host in the tree, with
   * the guests pruned by filterVmsByPermission).
   */
  nodesByConnection: Map<string, Set<string>>
  /**
   * True when the user holds a tag or pool grant. The perimeter is then whatever
   * still hosts a visible guest, unioned with the sets above. Never true for a
   * token principal.
   */
  guestDerived: boolean
  /**
   * Per-connection node names granted OUTRIGHT (node scope). Flat feeds gate on
   * this rather than on nodesByConnection so a vm grant does not open its whole
   * node (issue #525). Absent on a hand-built scope = every node listed in
   * nodesByConnection is an outright grant.
   */
  nodeGrantsByConnection?: Map<string, Set<string>>
  /** Per-connection VMIDs granted directly (vm scope). Absent = none. */
  guestGrantsByConnection?: Map<string, Set<string>>
}

/** Permission(s) a grant must carry to count; `undefined` = every grant counts. */
export type ScopePermissionFilter = string | readonly string[] | undefined

const TREE_SCOPE_TYPES = new Set(['connection', 'node', 'vm'])
const FLAT_SCOPE_TYPES = new Set(['tag', 'pool'])

/**
 * Build the tree mask from loaded grants. Returns null when the user is
 * unrestricted (super admin or holds a `global` scope); callers must then skip
 * RBAC tree pruning. A non-null scope with empty sets and `guestDerived: false`
 * restricts the tree to nothing (no infra and no flat grants).
 *
 * `permission` narrows the derivation to the grants that carry the permission
 * the route checked (any of them when a list is given): the perimeter is where
 * that permission was granted, and only a global grant OF that permission makes
 * the user unrestricted. Without it every grant counts, whatever it allows,
 * which is the #524 tree semantics.
 */
export function deriveRbacInfraScope(
  grants: {
    superAdmin: boolean
    byScope: ReadonlyArray<{ scopeType: string; scopeTarget: string | null; permissions?: ReadonlySet<string> }>
  },
  permission?: ScopePermissionFilter,
): RbacInfraScope | null {
  if (grants.superAdmin) return null
  const wanted = permission === undefined ? null : new Set(typeof permission === 'string' ? [permission] : permission)
  const carries = (g: { permissions?: ReadonlySet<string> }): boolean =>
    wanted === null || (g.permissions !== undefined && [...wanted].some(p => g.permissions!.has(p)))
  const relevant = grants.byScope.filter(carries)
  if (relevant.some(g => g.scopeType === 'global')) return null

  const fullConnections = new Set<string>()
  const nodesByConnection = new Map<string, Set<string>>()
  const nodeGrantsByConnection = new Map<string, Set<string>>()
  const guestGrantsByConnection = new Map<string, Set<string>>()
  let guestDerived = false

  const addTo = (map: Map<string, Set<string>>, connId: string, value: string) => {
    let set = map.get(connId)
    if (!set) {
      set = new Set<string>()
      map.set(connId, set)
    }
    set.add(value)
  }

  for (const g of relevant) {
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
    addTo(nodesByConnection, connId, nodeName)
    if (g.scopeType === 'node') {
      addTo(nodeGrantsByConnection, connId, nodeName)
    } else if (parts[3]) {
      addTo(guestGrantsByConnection, connId, parts[3])
    }
  }

  return { fullConnections, nodesByConnection, guestDerived, nodeGrantsByConnection, guestGrantsByConnection }
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
  return {
    fullConnections: new Set(connectionIds),
    nodesByConnection: new Map(),
    guestDerived: false,
    nodeGrantsByConnection: new Map(),
    guestGrantsByConnection: new Map(),
  }
}

/** Node names granted outright on a connection (see RbacInfraScope.nodeGrantsByConnection). */
function outrightNodes(scope: RbacInfraScope, connId: string): Set<string> | undefined {
  return scope.nodeGrantsByConnection ? scope.nodeGrantsByConnection.get(connId) : scope.nodesByConnection.get(connId)
}

/**
 * Whether the user holds an INFRA grant on a connection: the whole connection
 * or at least one node outright. A vm-only or tag / pool grant does not count,
 * those users are resource-flat and get no cluster or node facts (quorum, Ceph,
 * storage capacity, cluster cards). Null scope = admin, always true.
 */
export function hasInfraGrant(scope: RbacInfraScope | null, connId: string): boolean {
  if (scope === null) return true
  if (scope.fullConnections.has(connId)) return true
  return (outrightNodes(scope, connId)?.size ?? 0) > 0
}

/**
 * Row-level gate for FLAT feeds (change events, PVE tasks and logs, alerts,
 * alert rules): records that name a connection and maybe a node or a guest,
 * with no tree to prune. Null scope = admin / unrestricted. A guest-derived
 * (tag / pool) scope cannot be decided here, only the per-guest predicate can,
 * so it keeps every connection-bound row and the feed stays at its tenant-level
 * perimeter for such users.
 *
 * A row is visible when it sits on a node granted outright, or names a VMID
 * granted directly (vm scope, wherever the guest runs now). A row that names
 * a node or a guest matching neither is denied. A row naming neither is a
 * cluster-level fact (storage, quorum, a rule) kept only for a user holding a
 * node grant on that connection and only when `nodeBound` is false; a
 * node-bound row that could not be attributed (a VM alert on a cold index) is
 * denied. A row with no connection at all is provider-internal state and never
 * reaches a scoped user.
 */
export function isFlatRecordVisible(
  scope: RbacInfraScope | null,
  record: { connId?: string | null; node?: string | null; vmid?: string | number | null; nodeBound?: boolean },
): boolean {
  if (scope === null) return true
  const connId = record.connId
  if (!connId) return false
  if (scope.fullConnections.has(connId) || scope.guestDerived) return true
  const nodeGrants = outrightNodes(scope, connId)
  if (record.node && nodeGrants?.has(record.node)) return true
  const vmid = record.vmid === undefined || record.vmid === null ? undefined : String(record.vmid)
  if (vmid !== undefined && scope.guestGrantsByConnection?.get(connId)?.has(vmid)) return true
  if (record.node || vmid !== undefined) return false
  if (!nodeGrants || nodeGrants.size === 0) return false
  return record.nodeBound === false
}
