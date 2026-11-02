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

function diffById<T extends { id: string }>(draft: T[], last: T[], same: (a: T, b: T) => boolean): number {
  const before = new Map(last.map(x => [x.id, x]))
  let n = 0
  for (const x of draft) {
    const old = before.get(x.id)
    if (!old || !same(old, x)) n++
    before.delete(x.id)
  }
  return n + before.size
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
  const pending = draft.pending_members.length
  if (!last) return draft.zones.length + draft.flows.length + pending
  const snap = last.snapshot
  if (!snap) return pending
  const prefix = draft.tag_prefix !== undefined && draft.tag_prefix !== snap.tag_prefix ? 1 : 0
  return diffById(draft.zones, snap.zones, sameZone) + diffById(draft.flows, snap.flows, sameFlow) + pending + prefix
}
