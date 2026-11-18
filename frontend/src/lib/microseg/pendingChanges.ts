// src/lib/microseg/pendingChanges.ts

import type { GuestRefLite, MicrosegException, MicrosegFlow, MicrosegPolicy, MicrosegRevision, MicrosegZone, PendingMember } from './types'

/**
 * The identity of a guest across the clusters of a shared policy: its connection, type and VMID. VMIDs repeat between
 * clusters, and the node is left out because it changes when a guest migrates.
 */
export function clusterGuestId(connectionId: string, type: string, vmid: number): string {
  return `${connectionId}/${type}/${vmid}`
}

/** The pending members by guest identity (`connection_id` + type + VMID): a row of one cluster never marks another's guest. */
export function pendingByGuest(pending: readonly PendingMember[]): Map<string, PendingMember> {
  return new Map(pending.map(p => [clusterGuestId(p.connection_id, p.type, p.vmid), p]))
}

/**
 * The cluster of a row of any list (a pending member, an exception, a run, a suggestion): its own `connection_id`, or,
 * when it is empty or missing, the cluster it was read through. The backend fills the empty owners of its legacy rows
 * at start, so only an orchestrator older than shared policies (one cluster per policy) sends such a row.
 */
export function rowCluster(row: { connection_id?: string }, readThrough: string): string {
  return row.connection_id || readThrough
}

/**
 * The policy as every screen reads it: each pending member and each exception carries its cluster (rowCluster). A row
 * without one is the link the policy was read through: the answer's `policy.connection_id`, which the backend sets to
 * the URL's link, else the URL connection itself. The same object comes back when no row needs it.
 */
export function withRowClusters(policy: MicrosegPolicy, urlConnection: string): MicrosegPolicy {
  const own = policy.policy?.connection_id || urlConnection
  const members = Array.isArray(policy.pending_members) ? policy.pending_members : []
  const exceptions = Array.isArray(policy.exceptions) ? policy.exceptions : []
  if (members.every(p => p.connection_id) && exceptions.every(e => e.connection_id)) return policy
  return {
    ...policy,
    pending_members: members.map(p => ({ ...p, connection_id: rowCluster(p, own) })),
    exceptions: exceptions.map(e => ({ ...e, connection_id: rowCluster(e, own) })),
  }
}

export type MicrosegDraft = {
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  /** Absent: read as none. */
  exceptions?: MicrosegException[]
  pending_members: PendingMember[]
  tag_prefix?: string
}

function sameZone(a: MicrosegZone, b: MicrosegZone): boolean {
  const ta = a.observe_since ? Date.parse(a.observe_since) : null
  const tb = b.observe_since ? Date.parse(b.observe_since) : null
  return a.name === b.name && a.label === b.label && a.color === b.color && a.enforcement === b.enforcement
    && a.vnet_id === b.vnet_id && a.state === b.state && a.isolate_members === b.isolate_members && ta === tb
    && (a.egress_state ?? 'off') === (b.egress_state ?? 'off') && (a.egress_mode ?? 'local') === (b.egress_mode ?? 'local')
}

function sameFlow(a: MicrosegFlow, b: MicrosegFlow): boolean {
  return a.src_zone_id === b.src_zone_id && a.src_cidr === b.src_cidr && a.dst_zone_id === b.dst_zone_id
    && a.dst_cidr === b.dst_cidr && a.proto === b.proto && a.dport === b.dport && a.comment === b.comment
    && a.origin === b.origin
}

const sameGuests = (a: GuestRefLite[], b: GuestRefLite[]) =>
  a.length === b.length && a.every((g, i) => g.type === b[i].type && g.vmid === b[i].vmid && g.name === b[i].name)

/** By value, guests and services in their order (the orchestrator stores and compares them in order). Who wrote it does not count. */
function sameException(a: MicrosegException, b: MicrosegException): boolean {
  return a.zone_id === b.zone_id && a.comment === b.comment && sameGuests(a.sources, b.sources) && sameGuests(a.destinations, b.destinations)
    && a.services.length === b.services.length && a.services.every((s, i) => s.proto === b.services[i].proto && s.dport === b.services[i].dport)
}

export type DiffKind = 'added' | 'changed' | 'removed'

/**
 * What the draft changes over the last applied revision: each zone, flow and exception added, changed (by value) or
 * removed, by id; the items removed (from the revision's snapshot, to show them until the next apply); the pending members; the
 * tag prefix moved. Without a revision everything is added. Null when the revision came without its snapshot.
 */
export type PolicyDiff = {
  zones: ReadonlyMap<string, DiffKind>
  flows: ReadonlyMap<string, DiffKind>
  removedZones: MicrosegZone[]
  removedFlows: MicrosegFlow[]
  exceptions: ReadonlyMap<string, DiffKind>
  /** The exceptions the draft removed, as the revision holds them: still enforced until the next apply. */
  removedExceptions: MicrosegException[]
  /** The name each renamed zone had in the revision (the history logged it under that name). */
  renamedZones: ReadonlyMap<string, string>
  members: number
  prefix: boolean
}

function diffById<T extends { id: string }>(draft: T[], last: T[] | null, same: (a: T, b: T) => boolean): { kinds: Map<string, DiffKind>; removed: T[] } {
  const kinds = new Map<string, DiffKind>()
  const before = new Map((last ?? []).map(x => [x.id, x]))
  for (const x of draft) {
    const old = before.get(x.id)
    if (!old) kinds.set(x.id, 'added')
    else if (!same(old, x)) kinds.set(x.id, 'changed')
    before.delete(x.id)
  }
  const removed = [...before.values()]
  for (const x of removed) kinds.set(x.id, 'removed')
  return { kinds, removed }
}

export function policyDiff(draft: MicrosegDraft, last: MicrosegRevision | null): PolicyDiff | null {
  const snap = last ? last.snapshot : null
  if (last && !snap) return null
  const zones = diffById(draft.zones, snap ? snap.zones : null, sameZone)
  const flows = diffById(draft.flows, snap ? snap.flows : null, sameFlow)
  // A revision taken before the exceptions existed has no list: it held none.
  const exceptions = diffById(draft.exceptions ?? [], snap ? snap.exceptions ?? [] : null, sameException)
  const before = new Map((snap ? snap.zones : []).map(z => [z.id, z.name]))
  const renamedZones = new Map(draft.zones.filter(z => before.has(z.id) && before.get(z.id) !== z.name).map(z => [z.id, before.get(z.id)!]))
  return {
    zones: zones.kinds,
    flows: flows.kinds,
    removedZones: zones.removed,
    removedFlows: flows.removed,
    exceptions: exceptions.kinds,
    removedExceptions: exceptions.removed,
    renamedZones,
    members: draft.pending_members.length,
    prefix: !!snap && draft.tag_prefix !== undefined && draft.tag_prefix !== snap.tag_prefix,
  }
}

/** The number of changes a diff holds: one per zone, flow, exception and pending member, plus one for a moved tag prefix. */
export function diffCount(diff: PolicyDiff): number {
  return diff.zones.size + diff.flows.size + diff.exceptions.size + diff.members + (diff.prefix ? 1 : 0)
}

/**
 * Number of changes the draft holds over the last applied revision: zones,
 * flows and exceptions added, removed or edited (by value), plus every pending member, plus
 * one when the tag prefix moved. Without a revision everything counts.
 *
 * GET /policy returns `last_revision` without its snapshot; fetch it from
 * GET /revisions (limit 1) to get a full count. Without a snapshot only the
 * pending members can be counted, and the caller falls back to the server's
 * `pending_changes` flag.
 */
export function countPendingChanges(draft: MicrosegDraft, last: MicrosegRevision | null): number {
  const diff = policyDiff(draft, last)
  return diff ? diffCount(diff) : draft.pending_members.length
}
