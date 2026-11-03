import { NextResponse } from "next/server"

import { buildNodeResourceId, checkPermission } from "@/lib/rbac"
import { assertNodeName } from "@/lib/ssh/validate"

/**
 * What a drain request acts on (#248, #1218, roadmap#198): one node, a group
 * of nodes entering maintenance together (`config.nodes`), or a selection of
 * guests (`config.vmids`), which has no node. Read from the raw body, before
 * the config itself is sanitized, so the routes refuse a mixed request first.
 */
export type DrainScope =
  | { kind: "node"; node: string }
  | { kind: "group"; nodes: string[] }
  | { kind: "selection" }

export const MAX_GROUP_NODES = 64

export function parseDrainScope(body: any): { scope: DrainScope } | { error: string } {
  const node = body?.node
  const vmids = body?.config?.vmids
  const nodes = body?.config?.nodes
  const selection = Array.isArray(vmids) && vmids.length > 0
  const group = Array.isArray(nodes) && nodes.length > 0

  if ((node && (selection || group)) || (selection && group)) {
    return { error: "a drain names one node, a group of nodes or a selection of guests" }
  }
  if (selection) return { scope: { kind: "selection" } }
  if (group) {
    if (nodes.length < 2 || nodes.length > MAX_GROUP_NODES) return { error: `a group holds 2 to ${MAX_GROUP_NODES} nodes` }
    try {
      const names = nodes.map((n: unknown) => assertNodeName(n))
      if (new Set(names).size !== names.length) return { error: "a node is repeated in the group" }

      return { scope: { kind: "group", nodes: names } }
    } catch {
      return { error: "Invalid node name" }
    }
  }
  if (!node) return { error: "connection_id and node are required" }
  try {
    return { scope: { kind: "node", node: assertNodeName(node) } }
  } catch {
    return { error: "Invalid node name" }
  }
}

/** The nodes the drain empties: the node, the group, none for a selection. */
export function scopeNodes(scope: DrainScope): string[] {
  if (scope.kind === "node") return [scope.node]
  if (scope.kind === "group") return scope.nodes

  return []
}

/**
 * The refusal of the first node of the scope the caller lacks `permission`
 * on, or null. A selection is checked guest by guest elsewhere.
 */
export async function checkScopePermission(connectionId: string, scope: DrainScope, permission: string): Promise<Response | null> {
  const verdicts = await Promise.all(scopeNodes(scope).map(node =>
    checkPermission(permission, "node", buildNodeResourceId(connectionId, node))))

  return verdicts.find(denied => !!denied) ?? null
}

/** The `node` field the orchestrator expects: empty for a group or a selection. */
export const scopeNode = (scope: DrainScope): string => (scope.kind === "node" ? scope.node : "")

export const scopeError = (error: string) => NextResponse.json({ error }, { status: 400 })
