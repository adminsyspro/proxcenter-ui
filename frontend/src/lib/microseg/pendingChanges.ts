// src/lib/microseg/pendingChanges.ts

import type { MicrosegFlow, MicrosegRevision, MicrosegZone, PendingMember } from './types'

export type MicrosegDraft = {
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  pending_members: PendingMember[]
  tag_prefix?: string
}

function sameZone(a: MicrosegZone, b: MicrosegZone): boolean {
  const ta = a.observe_since ? Date.parse(a.observe_since) : null
  const tb = b.observe_since ? Date.parse(b.observe_since) : null
  return a.name === b.name && a.label === b.label && a.color === b.color && a.enforcement === b.enforcement
    && a.vnet_id === b.vnet_id && a.state === b.state && a.isolate_members === b.isolate_members && ta === tb
}

function sameFlow(a: MicrosegFlow, b: MicrosegFlow): boolean {
  return a.src_zone_id === b.src_zone_id && a.src_cidr === b.src_cidr && a.dst_zone_id === b.dst_zone_id
    && a.dst_cidr === b.dst_cidr && a.proto === b.proto && a.dport === b.dport && a.comment === b.comment
    && a.origin === b.origin
}

export type DiffKind = 'added' | 'changed' | 'removed'

/**
 * What the draft changes over the last applied revision: each zone and flow added, changed (by value) or removed, by
 * id; the items removed (from the revision's snapshot, to show them until the next apply); the pending members; the
 * tag prefix moved. Without a revision everything is added. Null when the revision came without its snapshot.
 */
export type PolicyDiff = {
  zones: ReadonlyMap<string, DiffKind>
  flows: ReadonlyMap<string, DiffKind>
  removedZones: MicrosegZone[]
  removedFlows: MicrosegFlow[]
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
  return {
    zones: zones.kinds,
    flows: flows.kinds,
    removedZones: zones.removed,
    removedFlows: flows.removed,
    members: draft.pending_members.length,
    prefix: !!snap && draft.tag_prefix !== undefined && draft.tag_prefix !== snap.tag_prefix,
  }
}

/** The number of changes a diff holds: one per zone, flow and pending member, plus one for a moved tag prefix. */
export function diffCount(diff: PolicyDiff): number {
  return diff.zones.size + diff.flows.size + diff.members + (diff.prefix ? 1 : 0)
}

/**
 * Number of changes the draft holds over the last applied revision: zones and
 * flows added, removed or edited (by value), plus every pending member, plus
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
