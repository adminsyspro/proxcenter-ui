import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import type { MicrosegCluster, MicrosegEvent, MicrosegSuggestion, MicrosegTraffic } from '@/lib/microseg/types'

import { postureGuests, type PostureGuest } from './dashboardPosture'
import type { VmSeries } from './postureTimeline'
import type { PolicyGuest } from './microseg/zoneModel'

/**
 * The Dashboard of a policy shared by several PVE connections, pure: which clusters it reads, and the merge of what
 * each of them answered into the figures of the whole policy, or of the one cluster its strip is filtered on. Zones are
 * the policy's: the figures of a zone on two clusters add up. No request here.
 */

/** The clusters of the policy the Dashboard is on. */
export type PolicyScope = {
  /** The policy is shared by two clusters or more: the Dashboard shows the whole policy and its cluster strip. */
  shared: boolean
  /** The clusters read, the selected connection first, then the other visible ones by ID; the connection alone when not shared. */
  readIds: string[]
  /** How many linked clusters the user cannot see: never read, their traffic is not in the figures. */
  hidden: number
}

const NO_SCOPE: PolicyScope = { shared: false, readIds: [], hidden: 0 }

/**
 * The scope of the Dashboard from the links of the policy (GET /policy `clusters`): the selected connection alone for
 * a policy of one cluster (or before the policy answered), else every linked cluster the user sees.
 */
export function policyScope(
  links: readonly Pick<MicrosegCluster, 'connection_id'>[] | undefined,
  connection: string | null,
  connections: readonly { id: string }[],
): PolicyScope {
  if (!connection) return NO_SCOPE
  const ids = [...new Set((links ?? []).map(l => l.connection_id))]
  if (ids.length < 2) return { shared: false, readIds: [connection], hidden: 0 }
  const seen = new Set(connections.map(c => c.id))
  const others = ids.filter(id => id !== connection && seen.has(id)).sort()
  const hidden = ids.filter(id => id !== connection && !seen.has(id)).length
  return { shared: true, readIds: [connection, ...others], hidden }
}

/** The cluster the strip is filtered on, if it is still one of the clusters read; null for the whole policy. */
export function clusterFilter(picked: { policyId: string; cluster: string } | null, policyId: string | undefined, scope: PolicyScope): string | null {
  if (!picked || !scope.shared || picked.policyId !== policyId) return null
  return scope.readIds.includes(picked.cluster) ? picked.cluster : null
}

/** The clusters whose figures are drawn: the filtered one, or every one read. */
export function shownIds(scope: PolicyScope, filter: string | null): string[] {
  return filter ? [filter] : scope.readIds
}

/** The cluster of an observed flow: its `connection_id`, or the connection read for a row that names none (older data). */
export const flowCluster = (s: Pick<MicrosegSuggestion, 'connection_id'>, fallback: string) => s.connection_id || fallback

/**
 * The observed flows the figures are made of: every row of a policy that is not shared (as read), else those of the
 * shown clusters only (a cluster outside the user's scope, or outside the filter, is left out).
 */
export function shownFlows(rows: MicrosegSuggestion[] | undefined, scope: PolicyScope, shown: readonly string[]): MicrosegSuggestion[] | undefined {
  if (!rows || !scope.shared) return rows
  const keep = new Set(shown)
  const fallback = scope.readIds[0]
  return rows.filter(s => keep.has(flowCluster(s, fallback)))
}

/** A guest key of a shared policy: the VMIDs of two clusters may be the same, so the key carries the cluster. */
export const clusterGuestKey = (cluster: string, key: string) => `${cluster}|${key}`

/**
 * The guests of each cluster read, as the posture figures take them: the coverage rows of the cluster joined with its
 * guest list when it was read (`listed`, null otherwise). On a shared policy each key carries its cluster, so the
 * guests of two clusters add up rather than merge.
 */
export function guestsByCluster(
  scope: PolicyScope,
  coverage: Readonly<Record<string, FirewallCoverage | null | undefined>>,
  listed: readonly PolicyGuest[] | null,
): Record<string, PostureGuest[]> {
  const out: Record<string, PostureGuest[]> = {}
  for (const id of scope.readIds) {
    const own = listed ? listed.filter(g => g.connectionId === id) : null
    const guests = postureGuests(coverage[id]?.guests, own)
    out[id] = scope.shared ? guests.map(g => ({ ...g, key: clusterGuestKey(id, g.key) })) : guests
  }
  return out
}

/**
 * The clusters among `ids` whose read neither answered nor failed: a figure that adds up the clusters is a total only
 * once this is empty (a sum of the reads that arrived is never shown as the total). A failed read is not pending: the
 * cluster is then said missing, and the others' figures stand.
 */
export function pendingClusters(ids: readonly string[], reads: { byCluster: Readonly<Record<string, unknown>>; errors: Readonly<Record<string, unknown>> }): string[] {
  return ids.filter(id => reads.byCluster[id] === undefined && !(id in reads.errors))
}

/** The guests of some clusters, one list. */
export function guestsOf(byCluster: Readonly<Record<string, PostureGuest[]>>, ids: readonly string[]): PostureGuest[] {
  if (ids.length === 1) return byCluster[ids[0]] ?? []
  return ids.flatMap(id => byCluster[id] ?? [])
}

/**
 * The persisted history of several clusters as one answer: the rows of each (a row is the hits of a zone pair in a
 * bucket, so the rows of the same zones add up when the chart stacks them) over the window and step of the first one.
 * Undefined until one of them answered.
 */
export function mergeHistories(answers: readonly (MicrosegTraffic | undefined)[]): MicrosegTraffic | undefined {
  const read = answers.filter((a): a is MicrosegTraffic => !!a)
  if (read.length <= 1) return read[0]
  const [first] = read
  // A cluster still on the previous range (another step) waits for its own answer of this one.
  const same = read.filter(a => a.step === first.step)
  return { ...first, buckets: same.flatMap(a => a.buckets) }
}

/** An event of the ring with the cluster it was read from, on a shared policy (its guest is looked up there). */
export type ClusterEvent = MicrosegEvent & { cluster?: string }

/** The guest key of an event: its cluster's guest on a shared policy. */
export function eventGuestKey(e: ClusterEvent): string {
  const key = `${e.type}/${e.vmid}`
  return e.cluster ? clusterGuestKey(e.cluster, key) : key
}

/**
 * The events of the ring of several clusters, one list, each with its cluster (`tag`, a shared policy). Undefined
 * until one of them answered.
 */
export function mergeClusterEvents(lists: readonly { cluster: string; events: MicrosegEvent[] | undefined }[], tag: boolean): ClusterEvent[] | undefined {
  const read = lists.filter(l => !!l.events)
  if (read.length === 0) return undefined
  if (!tag && read.length === 1) return read[0].events
  return read.flatMap(l => (tag ? l.events!.map(e => ({ ...e, cluster: l.cluster })) : l.events!))
}

/** The VMID of a guest key ("qemu/101", or "<cluster>|qemu/101" on a shared policy). */
export const guestVmid = (g: Pick<PostureGuest, 'key'>) => Number(g.key.slice(g.key.lastIndexOf('/') + 1))

/** The sFlow series of the guests shown (the filter keeps those of one cluster; sFlow keys them by VMID). */
export function seriesOf(series: readonly VmSeries[], guests: readonly PostureGuest[]): VmSeries[] {
  const vmids = new Set(guests.map(guestVmid))
  return series.filter(vm => vmids.has(vm.vmid))
}
