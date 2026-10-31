/**
 * Which nodes a caller may list (roadmap#184). The node list routes check
 * node.view without a resource, which a grant scoped to any node satisfies,
 * so they narrow their answer here, the way the inventory tree does: every
 * node of a connection granted whole, the nodes granted outright, and the
 * node hosting each VM granted directly (a VM User reaches the node detail of
 * its VMs, issue #378).
 */
import { getRequestGuestScopePerimeter, PERMISSIONS, type RbacInfraScope } from "@/lib/rbac"

/** Pure part: whether the scope names this node of this connection. Null scope = unrestricted. */
export function isNodeInScope(scope: RbacInfraScope | null, connId: string, node: string): boolean {
  if (!scope || scope.fullConnections.has(connId)) return true
  return scope.nodesByConnection.get(connId)?.has(node) ?? false
}

/**
 * Node names of one connection the caller may list, null for all of them. A
 * tag or pool scope adds the nodes hosting one of the caller's visible
 * guests, read from the inventory cache (nothing on a miss).
 */
export async function listableNodes(scope: RbacInfraScope | null, connId: string): Promise<ReadonlySet<string> | null> {
  if (!scope || scope.fullConnections.has(connId)) return null
  const nodes = new Set(scope.nodesByConnection.get(connId) ?? [])
  if (scope.guestDerived) {
    const perimeter = await getRequestGuestScopePerimeter(connId, PERMISSIONS.NODE_VIEW)
    for (const node of perimeter?.nodes ?? []) nodes.add(node)
  }
  return nodes
}
