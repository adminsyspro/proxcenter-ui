/**
 * Tool contract for the agentic assistant (#459).
 *
 * Every tool is read-only. There is deliberately no write verb in the registry:
 * the assistant answers questions about the infrastructure, it never changes
 * it, and the absence of a mutating tool is the enforcement, not a prompt line
 * asking the model to behave.
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

import type { AiSnapshot, AiGuest, AiNode } from '@/lib/ai/context'

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

export type AiToolContext = {
  snapshot: AiSnapshot
  tenantId: string
  locale: string
}

export type AiTool = {
  name: string
  /** Shown to the model. Says what question it answers, not how it works. */
  description: string
  parameters: ToolParameterSchema
  execute: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<unknown>
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

/* ------------------------------------------------------------------ */
/* Perimeter resolution                                               */
/* ------------------------------------------------------------------ */

export type ResolvedConnection = { id: string; name: string }

/** Every connection present in the snapshot, deduplicated. */
export function visibleConnections(snapshot: AiSnapshot): ResolvedConnection[] {
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
export function resolveConnection(ctx: AiToolContext, ref?: string): ResolvedConnection {
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
 * Resolve a node name inside a connection the caller may see.
 *
 * The node must appear in the RBAC-filtered snapshot: a node pruned by the
 * caller's infra scope is indistinguishable from a node that does not exist.
 */
export function resolveNode(ctx: AiToolContext, nodeRef: string | undefined, clusterRef?: string): {
  connection: ResolvedConnection
  node: AiNode
} {
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
export function resolveGuest(ctx: AiToolContext, ref: string | undefined): AiGuest {
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
