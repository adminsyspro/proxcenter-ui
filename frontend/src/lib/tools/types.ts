/**
 * Tool contract for the ProxCenter tool catalog.
 *
 * The catalog is consumer-agnostic: the in-app assistant (#459) drives it
 * through a tool-calling loop today, and the MCP endpoint planned for external
 * agents will list and call the very same entries. Nothing here knows about a
 * provider wire format or a context window; that lives in `@/lib/ai/tools`.
 *
 * Every tool declares whether it is read-only. The assistant only ever gets
 * the read-only ones, and the absence of a mutating tool in what it is handed
 * is the enforcement, not a prompt line asking the model to behave.
 *
 * SECURITY: tool arguments are produced by the model, which is itself steered
 * by user text. They are therefore untrusted input, exactly like a query
 * string. A tool must never pass a caller-supplied connection id, node name or
 * vmid to Proxmox without first resolving it against the RBAC-filtered
 * snapshot in the context. `resolveConnection`, `resolveNode` and
 * `resolveGuest` below are the only sanctioned way to do that: they look the
 * value up in what the caller may already see, so a model that asks for a node
 * outside the caller's scope gets a "not found" and no Proxmox call is made.
 */

import type { InventorySnapshot, SnapshotGuest, SnapshotNode } from '@/lib/tools/snapshot'

export type JsonSchemaProperty = {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
}

export type ToolParameterSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type ToolContext = {
  snapshot: InventorySnapshot
  tenantId: string
  locale: string
  /** The reader's IANA time zone, so a tool can say "14:05" rather than a UTC instant. */
  timeZone?: string
  /**
   * What this question has spent on the tools that cost a Proxmox call, shared
   * by every round of one request. A tool past its budget refuses: the model
   * then answers from what it already has.
   */
  usage?: { historyLookups: number; cveScans?: number }
}

export type CatalogTool = {
  name: string
  /** True when the tool cannot change anything. Mirrors MCP's `readOnlyHint`. */
  readOnly: boolean
  /** Shown to the model. Says what question it answers, not how it works. */
  description: string
  parameters: ToolParameterSchema
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

/**
 * `execute` for a tool that reads only the snapshot: a throw still reaches the
 * caller as a rejection, as it would from an async body.
 */
export function syncExecute(
  body: (args: Record<string, unknown>, ctx: ToolContext) => unknown
): CatalogTool['execute'] {
  return (args, ctx) => new Promise(resolve => resolve(body(args, ctx)))
}

/** Raised when the model asks for something the caller may not see. */
export class ToolScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolScopeError'
  }
}

/**
 * Raised when the model passes a value a tool cannot interpret.
 *
 * Surfaced to the model verbatim, like a scope refusal: naming the accepted
 * values is what gets the next call right.
 */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolArgumentError'
  }
}

/* ------------------------------------------------------------------ */
/* Argument coercion                                                  */
/* ------------------------------------------------------------------ */

/**
 * Models are loose with JSON types: a small local model will happily send
 * `"10"` for an integer or `"null"` for an omitted string.
 */
export function argString(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args?.[key]

  if (raw === undefined || raw === null) return undefined

  const value = String(raw).trim()

  if (!value || value === 'null' || value === 'undefined') return undefined

  return value
}

export function argNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  { min = 1, max = 100 }: { min?: number; max?: number } = {}
): number {
  const raw = argString(args, key)

  if (raw === undefined) return fallback

  const value = Number.parseInt(raw, 10)

  if (!Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, value))
}

export function argEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = argString(args, key)?.toLowerCase()

  if (!raw) return fallback

  if ((allowed as readonly string[]).includes(raw)) return raw as T

  // An unknown value used to fall back silently. Measured on llama3.1:8b (#459):
  // asked which VM uses the most CPU right now, it called the hardware ranking
  // with metric="cpu", got the vCPU ranking back under that name, and answered
  // that the busiest VM was the one with the most vCPUs. A wrong figure stated
  // with confidence is worse than a refusal the model can act on.
  throw new ToolArgumentError(`Invalid value "${raw}" for "${key}". Accepted values: ${allowed.join(', ')}.`)
}

/**
 * An enum argument that only orders or groups the output, never changes what
 * it means. An unknown value falls back to the default and leaves a note for
 * the caller instead of refusing the call.
 *
 * Refusing it is what lost an answer the tool already had: asked how many OSDs
 * each host carries, llama3.1:8b sent sortBy="none" (borrowed from groupBy),
 * got a refusal, and answered that the data did not say, while the per-host
 * roll-up does not depend on the sort at all. Arguments that change the
 * meaning of the result (a metric, a status filter) stay on `argEnum`.
 */
export function argPresentationEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  notes: string[]
): T {
  try {
    return argEnum(args, key, allowed, fallback)
  } catch (e) {
    if (!(e instanceof ToolArgumentError)) throw e

    notes.push(`${key}="${argString(args, key)}" is not accepted (${allowed.join(', ')}), used "${fallback}".`)

    return fallback
  }
}

/* ------------------------------------------------------------------ */
/* Perimeter resolution                                               */
/* ------------------------------------------------------------------ */

export type ResolvedConnection = { id: string; name: string }

/** Every connection present in the snapshot, deduplicated. */
export function visibleConnections(snapshot: InventorySnapshot): ResolvedConnection[] {
  return snapshot.clusters.map(c => ({ id: c.id, name: c.name }))
}

/**
 * Resolve a model-supplied cluster reference (id or display name) to a
 * connection the caller may actually see.
 *
 * With no argument and a single visible cluster, that cluster is used: asking
 * a single-cluster operator to name their cluster is friction for nothing.
 * With no argument and several clusters, the caller must be explicit.
 */
export function resolveConnection(ctx: ToolContext, ref?: string): ResolvedConnection {
  const available = visibleConnections(ctx.snapshot)

  if (available.length === 0) {
    throw new ToolScopeError('No cluster is visible to you.')
  }

  if (!ref) {
    if (available.length === 1) return available[0]

    // Naming the argument matters: llama3.1:8b, told only to "name one",
    // retried with an invented `clusterName` key and never got through.
    throw new ToolScopeError(
      `Several clusters are visible: pass the "cluster" argument with one of: ${available.map(c => c.name).join(', ')}.`
    )
  }

  const needle = ref.trim().toLowerCase()
  const hit = available.find(c => c.id.toLowerCase() === needle || c.name.toLowerCase() === needle)

  if (!hit) {
    throw new ToolScopeError(
      `Unknown cluster "${ref}". Visible clusters: ${available.map(c => c.name).join(', ')}.`
    )
  }

  return hit
}

/**
 * Resolve a node name the caller may see.
 *
 * The node must appear in the RBAC-filtered snapshot: a node pruned by the
 * caller's infra scope is indistinguishable from a node that does not exist.
 *
 * Without a cluster, a host name that exists in a single visible cluster is
 * enough. Demanding the cluster anyway cost a failed call against the lab,
 * where PVE-PROD and PVE-DR are both visible and "pve1" only lives in one.
 */
export function resolveNode(ctx: ToolContext, nodeRef: string | undefined, clusterRef?: string): {
  connection: ResolvedConnection
  node: SnapshotNode
} {
  if (nodeRef && !clusterRef) {
    const needle = nodeRef.trim().toLowerCase()
    const matches = ctx.snapshot.nodes.filter(n => n.name.toLowerCase() === needle)
    const connections = visibleConnections(ctx.snapshot)

    if (matches.length === 1) {
      const connection = connections.find(c => c.id === matches[0].connId)

      if (connection) return { connection, node: matches[0] }
    }

    if (matches.length > 1) {
      throw new ToolScopeError(
        `Several clusters have a host named "${nodeRef}": pass the "cluster" argument with one of: ${matches.map(n => n.cluster).join(', ')}.`
      )
    }

    if (connections.length > 1) {
      throw new ToolScopeError(
        `Unknown host "${nodeRef}". Visible hosts: ${ctx.snapshot.nodes.map(n => n.name).join(', ') || 'none'}.`
      )
    }
  }

  const connection = resolveConnection(ctx, clusterRef)
  const candidates = ctx.snapshot.nodes.filter(n => n.connId === connection.id)

  if (!nodeRef) {
    if (candidates.length === 1) return { connection, node: candidates[0] }

    throw new ToolScopeError(
      `Name a host, one of: ${candidates.map(n => n.name).join(', ') || 'none visible'}.`
    )
  }

  const needle = nodeRef.trim().toLowerCase()
  const node = candidates.find(n => n.name.toLowerCase() === needle)

  if (!node) {
    throw new ToolScopeError(
      `Unknown host "${nodeRef}" in cluster ${connection.name}. Visible hosts: ${candidates.map(n => n.name).join(', ') || 'none'}.`
    )
  }

  return { connection, node }
}

/**
 * Resolve a guest by name or vmid, across every cluster the caller may see.
 *
 * Name matching is exact first, then case-insensitive, then unique substring:
 * a user says "the database VM" and the model passes "database", which should
 * find `db-01` if that is the only candidate rather than failing outright.
 */
export function resolveGuest(ctx: ToolContext, ref: string | undefined): SnapshotGuest {
  if (!ref) throw new ToolScopeError('Name a VM or container, by name or by vmid.')

  const needle = ref.trim().toLowerCase()
  const guests = ctx.snapshot.guests

  const byVmid = guests.filter(g => g.vmid === needle)

  if (byVmid.length === 1) return byVmid[0]

  const exact = guests.filter(g => g.name.toLowerCase() === needle)

  if (exact.length === 1) return exact[0]

  if (exact.length > 1) {
    throw new ToolScopeError(
      `Several guests are named "${ref}": ${exact.map(g => `${g.name} (${g.vmid} on ${g.cluster})`).join(', ')}. Use the vmid.`
    )
  }

  const partial = guests.filter(g => g.name.toLowerCase().includes(needle))

  if (partial.length === 1) return partial[0]

  if (partial.length > 1) {
    throw new ToolScopeError(
      `"${ref}" matches several guests: ${partial.slice(0, 10).map(g => `${g.name} (${g.vmid})`).join(', ')}. Be more specific.`
    )
  }

  throw new ToolScopeError(`No VM or container matching "${ref}" is visible to you.`)
}
