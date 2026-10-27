// src/lib/availability/scope.ts
//
// The perimeter sent to the orchestrator with every availability call. It is
// always built here, from the session's tenant and RBAC grants, never read
// from the client. Same semantics as internal/availability/scope.go: null is
// the provider, a connection absent from `connections` is not visible, the
// cluster row is visible only with `all`, a guest through its pool.

import type { RbacInfraScope } from '@/lib/rbac/infraScope'
import type { InfraScope } from '@/lib/tenant/infraScope'

import type { AvailabilityScope, ConnScope, ObjectRef } from './types'

export function toAvailabilityScope(infra: InfraScope): AvailabilityScope | null {
  switch (infra.kind) {
    case 'provider':
      return null
    case 'msp': {
      const connections: Record<string, ConnScope> = {}
      for (const id of infra.connectionIds) connections[id] = { all: true }
      return { connections }
    }
    case 'iaas': {
      const { vdcScope } = infra
      const connections: Record<string, ConnScope> = {}
      for (const id of vdcScope.connectionIds) {
        connections[id] = {
          all: false,
          nodes: [...(vdcScope.nodesByConnection.get(id) ?? [])].sort(),
          pools: [...(vdcScope.poolsByConnection.get(id) ?? [])].sort(),
        }
      }
      return { connections }
    }
  }
}

/** The tenant's entry for a connection; the provider sees every connection whole. */
export function connScope(scope: AvailabilityScope | null, connectionId: string): ConnScope | null {
  if (scope === null) return { all: true }
  return Object.hasOwn(scope.connections, connectionId) ? scope.connections[connectionId] : null
}

export function allowsNode(scope: AvailabilityScope | null, connectionId: string, node: string): boolean {
  const c = connScope(scope, connectionId)
  return c !== null && (c.all || (c.nodes ?? []).includes(node))
}

/**
 * Whether a node or cluster row lies in the perimeter: the cluster only with
 * the whole connection. Guests are not rows of the overview. The orchestrator
 * already filters; the overview checks again before anything goes out.
 */
export function allowsInfraRef(scope: AvailabilityScope | null, ref: ObjectRef): boolean {
  if (ref.kind === 'cluster') return connScope(scope, ref.connection_id)?.all === true
  if (ref.kind === 'node') return typeof ref.node === 'string' && allowsNode(scope, ref.connection_id, ref.node)
  return false
}

/**
 * Narrows the tenant perimeter to where the user holds `connection.view`
 * (null = unrestricted). A connection granted whole keeps the tenant entry;
 * node grants keep those nodes and no guest (a node grant names no pool);
 * anything else (tag, pool or vm grants only) drops the connection: the
 * registry cannot express a guest-derived perimeter, so it fails closed.
 */
export function narrowByRbac(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  rbac: RbacInfraScope | null,
): { scope: AvailabilityScope | null; connectionIds: string[] } {
  if (rbac === null) return { scope, connectionIds: [...connectionIds] }
  const nodeGrants = rbac.nodeGrantsByConnection ?? rbac.nodesByConnection
  const connections: Record<string, ConnScope> = {}
  for (const id of connectionIds) {
    const tenant = connScope(scope, id)
    if (tenant === null) continue
    if (rbac.fullConnections.has(id)) {
      connections[id] = tenant
      continue
    }
    const granted = nodeGrants.get(id)
    if (!granted?.size) continue
    const nodes = tenant.all ? [...granted] : (tenant.nodes ?? []).filter(n => granted.has(n))
    if (nodes.length) connections[id] = { all: false, nodes: nodes.sort(), pools: [] }
  }
  return { scope: { connections }, connectionIds: connectionIds.filter(id => Object.hasOwn(connections, id)) }
}
