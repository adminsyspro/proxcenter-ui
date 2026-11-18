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
