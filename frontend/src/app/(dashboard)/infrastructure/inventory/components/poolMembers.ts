/**
 * Pool membership edits of the Pools view (roadmap#200): what the members
 * dialog shows and the Proxmox-shaped requests a set of edits turns into.
 */

export type PoolGuest = { vmid: number; type: string; node: string; name: string | null; status: string | null; template?: boolean }
export type PoolStorage = { storage: string; type: string | null; shared: boolean; nodes: string[] }
export type PoolMembersPayload = { poolid: string; comment: string | null; guests: PoolGuest[]; storages: PoolStorage[] }

/** A guest of the cluster that may join the pool, with the pool it is in now. */
export type GuestCandidate = PoolGuest & { pool?: string | null }

/** One PUT body of the pools route, as Proxmox takes it. */
export type PoolMemberRequest = { poolid: string; vms?: number[]; storage?: string[]; delete?: true; allowMove?: true }

export type PoolMemberEdits = {
  addGuests: GuestCandidate[]
  removeGuests: number[]
  addStorages: string[]
  removeStorages: string[]
}

/** A pool a vDC is built on: its members are the vDC's, never edited from here. */
export const isVdcPool = (poolid: string | null | undefined) => !!poolid && poolid.startsWith('vdc-')

/**
 * Guests that may be added: not already members, no template, and not held by
 * a vDC pool (the route refuses to move them out of it).
 */
export function guestCandidates(all: GuestCandidate[], members: PoolGuest[], poolid: string): GuestCandidate[] {
  const inPool = new Set(members.map(m => m.vmid))

  return all
    .filter(g => !inPool.has(g.vmid) && !g.template && g.pool !== poolid && !isVdcPool(g.pool))
    .sort((a, b) => a.vmid - b.vmid)
}

/** Storages that may be added: the cluster's, once each, minus the members. */
export function storageCandidates(all: string[], members: PoolStorage[]): string[] {
  const inPool = new Set(members.map(m => m.storage))

  return [...new Set(all)].filter(s => !inPool.has(s)).sort((a, b) => a.localeCompare(b))
}

/**
 * At most two calls: everything added in one (moving the guests that sit in
 * another pool), everything removed in the other. Proxmox fails a whole call
 * on one bad member, so the two stay apart.
 */
export function memberRequests(poolid: string, edits: PoolMemberEdits): PoolMemberRequest[] {
  const requests: PoolMemberRequest[] = []
  const addVms = edits.addGuests.map(g => g.vmid)

  if (addVms.length || edits.addStorages.length) {
    requests.push({
      poolid,
      ...(addVms.length ? { vms: addVms } : {}),
      ...(edits.addStorages.length ? { storage: edits.addStorages } : {}),
      ...(edits.addGuests.some(g => !!g.pool) ? { allowMove: true as const } : {}),
    })
  }

  if (edits.removeGuests.length || edits.removeStorages.length) {
    requests.push({
      poolid,
      ...(edits.removeGuests.length ? { vms: edits.removeGuests } : {}),
      ...(edits.removeStorages.length ? { storage: edits.removeStorages } : {}),
      delete: true,
    })
  }

  return requests
}
