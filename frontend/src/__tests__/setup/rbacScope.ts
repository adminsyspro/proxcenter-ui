/**
 * RBAC infra-scope fixtures shared by the aggregate-read route tests
 * (issue #525). One place for the scope shapes so a test reads as a grant
 * ("node n1 of c1") instead of a three-line literal, and one accessor for
 * the scope a route forwarded into a mocked visibility predicate.
 */
import type { RbacInfraScope } from '@/lib/rbac/infraScope'

const EMPTY = (): RbacInfraScope => ({
  fullConnections: new Set(),
  nodesByConnection: new Map(),
  guestDerived: false,
  nodeGrantsByConnection: new Map(),
  guestGrantsByConnection: new Map(),
})

/** A connection-scoped grant on `conn-1`, used as an opaque forwarded value. */
export const FAKE_RBAC_SCOPE: RbacInfraScope = { ...EMPTY(), fullConnections: new Set(['conn-1']) }

/** Node grants on one connection. */
export function nodeScope(connId: string, ...nodes: string[]): RbacInfraScope {
  return {
    ...EMPTY(),
    nodesByConnection: new Map([[connId, new Set(nodes)]]),
    nodeGrantsByConnection: new Map([[connId, new Set(nodes)]]),
  }
}

/** A single vm grant `connId:node:qemu:vmid`: the node shows in the tree, nothing else is granted. */
export function vmScope(connId: string, node: string, vmid: string): RbacInfraScope {
  return {
    ...EMPTY(),
    nodesByConnection: new Map([[connId, new Set([node])]]),
    guestGrantsByConnection: new Map([[connId, new Set([vmid])]]),
  }
}

/** Whole-connection grants. */
export function connectionScope(...connIds: string[]): RbacInfraScope {
  return { ...EMPTY(), fullConnections: new Set(connIds) }
}

/** A tag / pool only grant: no infra perimeter of its own. */
export function guestDerivedScope(): RbacInfraScope {
  return { ...EMPTY(), guestDerived: true }
}

/** `rbacScope` of the ctx a route passed to the FIRST call of a mocked predicate. */
export function forwardedRbacScope(predicate: { mock: { calls: unknown[][] } }): unknown {
  const ctx = predicate.mock.calls[0]?.[1] as { rbacScope?: unknown } | undefined
  return ctx?.rbacScope
}
