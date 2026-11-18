// The clusters (PVE connections) that share one micro-segmentation policy, as plain data: their names, the
// connections that can still join, what leaving costs, and the entries of the page's connection selector.

import type { MicrosegZone } from '@/lib/microseg/types'

export type NamedConnection = { id: string; name: string }

/** What `dissociationImpact` needs of a guest: its cluster and its tags (a zone member carries `<prefix><zone>`). */
export type GroupGuest = { connectionId: string; tags: string[] }

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The visible connections of `ids`, sorted by name; a connection the user cannot see is left out. */
export function visible(ids: readonly string[], connections: readonly NamedConnection[]): NamedConnection[] {
  const byId = new Map(connections.map(c => [c.id, c]))
  return ids.flatMap(id => byId.get(id) ?? []).sort((a, b) => names.compare(a.name, b.name) || a.id.localeCompare(b.id))
}

/** "PVE-DR + PVE-PROD": the names of the clusters, sorted; a connection the user cannot see is left out. */
export function clusterNames(ids: readonly string[], connections: readonly NamedConnection[]): string {
  return visible(ids, connections).map(c => c.name).join(' + ')
}

/**
 * The connections that can join the group, by name: every PVE connection outside it, except those already sharing
 * another policy (`elsewhere`, from the groups the page read).
 */
export function candidates(
  connections: readonly NamedConnection[],
  group: readonly string[],
  elsewhere: readonly string[] = [],
): NamedConnection[] {
  const excluded = new Set([...group, ...elsewhere])
  return visible(connections.map(c => c.id).filter(id => !excluded.has(id)), connections)
}

/** The connections that share a policy with at least one other, from the groups read for the selector. */
export function sharedConnections(groups: Readonly<Record<string, readonly string[]>>): string[] {
  return [...new Set(Object.values(groups).filter(ids => ids.length > 1).flat())].sort()
}

/**
 * What a dissociation of `targetId` takes away: the members of an active zone (observed or enforced) on the target,
 * which the other clusters stop recognising, and those on the other clusters, which the target stops recognising.
 * A guest counts once whatever the number of zones it is tagged with.
 */
export function dissociationImpact(
  guests: readonly GroupGuest[],
  zones: readonly Pick<MicrosegZone, 'name' | 'state'>[],
  targetId: string,
  tagPrefix: string,
): { leaving: number; staying: number } {
  // PVE lowercases tags; the prefix and the zone name are compared the same way (zoneMembers does too).
  const activeTags = new Set(zones.filter(z => z.state !== 'disabled').map(z => `${tagPrefix}${z.name}`.toLowerCase()))
  let leaving = 0
  let staying = 0
  for (const g of guests) {
    if (!g.tags.some(tag => activeTags.has(tag.toLowerCase()))) continue
    if (g.connectionId === targetId) leaving++
    else staying++
  }
  return { leaving, staying }
}

/** One entry of the connection selector: a connection alone, or every visible cluster of a shared policy. */
export type SelectorEntry = { value: string; label: string; ids: string[] }

/**
 * The entries of the connection selector of the Dashboard and Micro-segmentation tabs: the clusters of one group collapse into one
 * entry, at the place of its first member in `connections`, labelled with `clusterNames` and valued with the group's
 * anchor (its smallest ID; the smallest visible one when the anchor is not visible). `groups` holds the cluster IDs
 * known for a connection; a connection without one stands alone.
 */
export function selectorEntries(connections: readonly NamedConnection[], groups: Readonly<Record<string, readonly string[]>>): SelectorEntry[] {
  const known = new Set(connections.map(c => c.id))
  const placed = new Set<string>()
  const entries: SelectorEntry[] = []
  for (const c of connections) {
    if (placed.has(c.id)) continue
    const group = groups[c.id] ?? [c.id]
    const ids = [...new Set([c.id, ...group])].filter(id => known.has(id) && !placed.has(id)).sort()
    for (const id of ids) placed.add(id)
    entries.push({ value: ids[0], label: ids.length > 1 ? clusterNames(ids, connections) : c.name, ids })
  }
  return entries
}

/** The entry that holds a connection. */
export function entryOf(entries: readonly SelectorEntry[], connectionId: string): SelectorEntry | undefined {
  return entries.find(e => e.ids.includes(connectionId))
}

/**
 * The connection the page is on after `left` was dissociated from its group. A page on another cluster stays where it
 * is; a page on the cluster that left would follow it to its own, now separate, policy, so it moves to the cluster
 * that remains: the new anchor of the group (its smallest visible ID), or the selection itself when none is visible.
 */
export function selectionAfterDissociation(
  selected: string,
  left: string,
  remaining: readonly string[],
  connections: readonly NamedConnection[],
): string {
  if (selected !== left) return selected
  const known = new Set(connections.map(c => c.id))
  return remaining.filter(id => id !== left && known.has(id)).sort()[0] ?? selected
}
