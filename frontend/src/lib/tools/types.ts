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

import type { ActionBinding, AiActionsSettings } from '@/lib/ai/actions/types'
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
  usage?: {
    historyLookups: number
    cveScans?: number
    proposals?: number
    /** Remediation plans this question asked for: one at most. */
    plans?: number
    /**
     * Tail of the Proxmox reads the action preflights make for this question
     * (`serialPveRead` in `@/lib/ai/actions/preflight`): the loop runs up to
     * four tool calls at once, and they must not take several of a node's
     * three pvedaemon workers together.
     */
    pveChain?: Promise<void>
  }
  /**
   * Set only when the assistant may propose actions (roadmap#188): what is
   * enabled, who the signed cards are issued to, and the conversation text a
   * proposal target may be grounded on (`conversationGrounding` in
   * `@/lib/ai/actions/grounding`): user and assistant turns for a name, user
   * turns only for a vmid. Without it the proposal tools refuse.
   */
  actions?: { settings: AiActionsSettings; bind: ActionBinding; visibleText: string; userText: string }
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
 * One of several targets a reference matched, offered to the user as a
 * clickable row under the answer (roadmap#188). `reply` is sent as the user's
 * next message when clicked, and names the target precisely enough to resolve
 * it alone: the vmid and the cluster for a guest, the cluster for a host.
 */
export type TargetChoice = { label: string; reply: string; kind: 'guest' | 'host' | 'cluster'; guestKind?: 'qemu' | 'lxc' }

/** At most this many choices reach the user: past it, a narrower question beats a long list. */
export const MAX_TARGET_CHOICES = 8

/**
 * A scope refusal for a reference that matched several targets: two VMs of
 * the same name, a host name two clusters share, several clusters and none
 * named. The model reads the same text as before; the choices are computed
 * here, never by the model, and travel beside the result to the widget (the
 * loop lifts them into the trace, like the charts and the cards).
 */
export class AmbiguousTargetError extends ToolScopeError {
  readonly choices: TargetChoice[]

  constructor(message: string, choices: TargetChoice[]) {
    super(message)
    this.name = 'AmbiguousTargetError'
    this.choices = choices.slice(0, MAX_TARGET_CHOICES)
  }
}

export function guestChoice(g: SnapshotGuest): TargetChoice {
  return {
    kind: 'guest',
    guestKind: g.kind,
    label: `${g.name} · #${g.vmid} · ${g.node} · ${g.cluster}`,
    reply: `${g.name} (vmid ${g.vmid}, ${g.node}, ${g.cluster})`,
  }
}

export function hostChoice(n: SnapshotNode): TargetChoice {
  return { kind: 'host', label: `${n.name} · ${n.cluster}`, reply: `${n.name} (${n.cluster})` }
}

export function clusterChoice(c: { name: string }): TargetChoice {
  return { kind: 'cluster', label: c.name, reply: c.name }
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
    throw new AmbiguousTargetError(
      `Several clusters are visible: pass the "cluster" argument with one of: ${available.map(c => c.name).join(', ')}.`,
      available.map(clusterChoice)
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
/**
 * `pve1 (PVE-PROD)`, the reply of a host choice, when the model passes it
 * whole as the host: split into the host and its cluster, only when that
 * cluster is visible.
 */
function splitHostReply(ctx: ToolContext, nodeRef: string): { nodeRef: string; clusterRef?: string } {
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(nodeRef.trim())

  if (!m) return { nodeRef }

  const cluster = m[2].trim().toLowerCase()
  const visible = visibleConnections(ctx.snapshot).some(c => c.name.toLowerCase() === cluster || c.id.toLowerCase() === cluster)

  return visible ? { nodeRef: m[1], clusterRef: m[2].trim() } : { nodeRef }
}

export function resolveNode(ctx: ToolContext, nodeArg: string | undefined, clusterArg?: string): {
  connection: ResolvedConnection
  node: SnapshotNode
} {
  const { nodeRef, clusterRef } = nodeArg && !clusterArg ? splitHostReply(ctx, nodeArg) : { nodeRef: nodeArg, clusterRef: clusterArg }

  if (nodeRef && !clusterRef) {
    const needle = nodeRef.trim().toLowerCase()
    const matches = ctx.snapshot.nodes.filter(n => n.name.toLowerCase() === needle)
    const connections = visibleConnections(ctx.snapshot)

    if (matches.length === 1) {
      const connection = connections.find(c => c.id === matches[0].connId)

      if (connection) return { connection, node: matches[0] }
    }

    if (matches.length > 1) {
      throw new AmbiguousTargetError(
        `Several clusters have a host named "${nodeRef}": pass the "cluster" argument with one of: ${matches.map(n => n.cluster).join(', ')}.`,
        matches.map(hostChoice)
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

    const message = `Name a host, one of: ${candidates.map(n => n.name).join(', ') || 'none visible'}.`

    if (candidates.length === 0) throw new ToolScopeError(message)

    throw new AmbiguousTargetError(message, candidates.map(hostChoice))
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

type GuestRef = { vmid: string; kind?: 'qemu' | 'lxc'; name?: string; node?: string; cluster?: string }

/** `VM 111`, `vm111`, `CT 101`, `vmid 111`, `#111`, `qemu/111`, `lxc 101`. */
const PREFIXED_VMID = /^(?:(vmid|vm|qemu|ct|lxc)\s*[#:/]?\s*|#\s*)(\d+)$/i

/** `w22-i1000 (vmid 111, pve3, PVE-PROD)`: the reply of a guest choice. */
const CHOICE_REPLY = /^(.+?)\s*\(\s*vmid\s+(\d+)\s*(?:,\s*([^,()]+?)\s*)?(?:,\s*([^()]+?)\s*)?\)$/i

/**
 * The vmid a guest reference carries besides the bare number. Small models
 * pass what the user wrote: "VM 100" failed on every tool when only "100"
 * was understood.
 */
export function parseGuestRef(ref: string): GuestRef | null {
  const text = ref.trim()
  const prefixed = PREFIXED_VMID.exec(text)

  if (prefixed) {
    const word = prefixed[1]?.toLowerCase()
    const kind = word === 'ct' || word === 'lxc' ? 'lxc' : word === 'vm' || word === 'qemu' ? 'qemu' : undefined

    return { vmid: prefixed[2], ...(kind ? { kind } : {}) }
  }

  const reply = CHOICE_REPLY.exec(text)

  if (!reply) return null

  return {
    vmid: reply[2],
    name: reply[1].trim(),
    ...(reply[3] ? { node: reply[3] } : {}),
    ...(reply[4] ? { cluster: reply[4] } : {}),
  }
}

/** Keeps the guests matching each detail of the reference, a detail that would leave none being ignored. */
function narrowByRef(guests: SnapshotGuest[], ref: GuestRef): SnapshotGuest[] {
  const lower = (v: string) => v.trim().toLowerCase()
  const filters: Array<((g: SnapshotGuest) => boolean) | null> = [
    ref.kind ? g => g.kind === ref.kind : null,
    ref.cluster ? g => lower(g.cluster) === lower(ref.cluster!) || lower(g.connId) === lower(ref.cluster!) : null,
    ref.node ? g => lower(g.node) === lower(ref.node!) : null,
    ref.name ? g => lower(g.name) === lower(ref.name!) : null,
  ]

  return filters.reduce((kept, f) => {
    if (!f) return kept

    const narrowed = kept.filter(f)

    return narrowed.length ? narrowed : kept
  }, guests)
}

/**
 * Resolve a guest by name or vmid, across every cluster the caller may see.
 *
 * Name matching is exact first, then case-insensitive, then unique substring:
 * a user says "the database VM" and the model passes "database", which should
 * find `db-01` if that is the only candidate rather than failing outright.
 * A vmid is read bare or in the forms of `parseGuestRef`. Several matches are
 * an `AmbiguousTargetError`: the user picks, the model never does.
 */
/**
 * The guests of `guests` a migration to host `dest` can concern: those of a
 * cluster that has that host (a guest only moves within its cluster), and not
 * already on it. Narrows same-named guests: "move Ubuntu to pve1-dr" is about
 * the Ubuntu of PVE-DR, not the one of PVE-PROD.
 */
export function guestsMovableTo(ctx: ToolContext, guests: SnapshotGuest[], dest: string): SnapshotGuest[] {
  const host = dest.trim().toLowerCase()
  const clusters = new Set(ctx.snapshot.nodes.filter(n => n.name.toLowerCase() === host).map(n => n.connId))

  return guests.filter(g => clusters.has(g.connId) && g.node.toLowerCase() !== host)
}

export function resolveGuest(ctx: ToolContext, ref: string | undefined): SnapshotGuest {
  if (!ref) throw new ToolScopeError('Name a VM or container, by name or by vmid.')

  const needle = ref.trim().toLowerCase()
  const guests = ctx.snapshot.guests
  const exact = guests.filter(g => g.name.toLowerCase() === needle)
  // A guest really named "vm100" is found by its name, not as vmid 100.
  const parsed: GuestRef | null = /^\d+$/.test(needle) ? { vmid: needle } : exact.length ? null : parseGuestRef(ref)

  if (parsed) {
    const byVmid = narrowByRef(guests.filter(g => g.vmid === parsed.vmid), parsed)

    if (byVmid.length === 1) return byVmid[0]

    // Two clusters may reuse a vmid: falling through to a name match found nothing.
    if (byVmid.length > 1) {
      throw new AmbiguousTargetError(
        `Several guests have vmid ${parsed.vmid}: ${byVmid.map(g => `${g.name} (${g.vmid} on ${g.cluster})`).join(', ')}. Pass the "cluster" argument.`,
        byVmid.map(guestChoice)
      )
    }
  }

  if (exact.length === 1) return exact[0]

  if (exact.length > 1) {
    throw new AmbiguousTargetError(
      `Several guests are named "${ref}": ${exact.map(g => `${g.name} (${g.vmid} on ${g.cluster})`).join(', ')}. Use the vmid.`,
      exact.map(guestChoice)
    )
  }

  const partial = guests.filter(g => g.name.toLowerCase().includes(needle))

  if (partial.length === 1) return partial[0]

  if (partial.length > 1) {
    throw new AmbiguousTargetError(
      `"${ref}" matches several guests: ${partial.slice(0, 10).map(g => `${g.name} (${g.vmid})`).join(', ')}. Be more specific.`,
      partial.map(guestChoice)
    )
  }

  throw new ToolScopeError(`No VM or container matching "${ref}" is visible to you.`)
}
