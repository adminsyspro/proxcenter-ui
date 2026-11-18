// src/lib/microseg/runRefresh.ts

import { microsegBaseUrl } from './api'

/** The inventory read that gives the zone members (guests tagged `<prefix><zone>`) of a connection. */
export function zoneGuestsUrl(connId: string): string {
  return `/api/v1/vms?connId=${encodeURIComponent(connId)}`
}

/**
 * Matches the SWR keys a finished run (apply, state change, restore, removal) can make stale on a connection:
 * the status, the runs list and run results, the revisions (list and last snapshot), the drifts and the zone members.
 * The policy is not in it: its owner reloads it. Takes one connection or the connections of a group.
 */
export function isRunAffectedKey(connIds: string | readonly string[]) {
  const matchers = (typeof connIds === 'string' ? [connIds] : connIds).map(connId => {
    const base = microsegBaseUrl(connId)
    const guests = zoneGuestsUrl(connId)
    return (head: string): boolean => head === `${base}/status`
      || head === `${base}/drifts`
      || head === `${base}/runs`
      || head.startsWith(`${base}/runs/`)
      || head.startsWith(`${base}/revisions`)
      || head === guests
  })
  return (key: unknown): boolean => {
    const head: unknown = Array.isArray(key) ? key[0] : key
    if (typeof head !== 'string') return false
    return matchers.some(match => match(head))
  }
}

/**
 * How long after a run the zone members are read once more: the server keeps the guest list of a connection 15 s, and
 * Proxmox can take a few seconds to list a tag just written.
 */
export const GUEST_LIST_SETTLE_MS = 16_000

/** Matches the SWR keys of the zone members of these connections. */
export function isZoneGuestsKey(connIds: readonly string[]) {
  const urls = new Set(connIds.map(zoneGuestsUrl))
  return (key: unknown): boolean => {
    const head: unknown = Array.isArray(key) ? key[0] : key
    return typeof head === 'string' && urls.has(head)
  }
}

/**
 * The zone members after a run, which moved tags: the guest list the server keeps 15 s was read before the run wrote
 * them, so reading it again at once answers the old tags and nothing reads it later. The server is asked for a fresh
 * list of each connection (`refresh=list`: 2 Proxmox calls, at most once per 30 s per connection), then the members
 * are read again; and once more after GUEST_LIST_SETTLE_MS, for a forced read that was refused or a tag Proxmox did
 * not list yet. Returns what cancels the reads still to come (a newer run, the tab left).
 */
export function refreshZoneGuestsAfterRun(
  mutate: (matcher: (key: unknown) => boolean) => unknown,
  connIds: readonly string[],
  fetcher: (url: string) => Promise<unknown> = url => fetch(url),
): () => void {
  const guests = isZoneGuestsKey(connIds)
  let cancelled = false
  const again = () => { if (!cancelled) void mutate(guests) }
  void Promise.allSettled(connIds.map(id => fetcher(`${zoneGuestsUrl(id)}&refresh=list`))).then(again)
  const timer = setTimeout(again, GUEST_LIST_SETTLE_MS)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
