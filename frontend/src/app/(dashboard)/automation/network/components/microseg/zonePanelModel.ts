import type { MicrosegDrift, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { clusterGuestId } from '@/lib/microseg/pendingChanges'

import { driftKey, zoneOfDrift } from './driftLabels'
import { guestKey, memberId, type ZoneMember } from './zoneModel'

/**
 * What the engine's drifts tell of a zone in its panel: how many concern it, and the members with their NIC firewall off
 * (by `guestId`: cluster, type and VMID; `cluster` when the caller named the cluster the drifts were read from).
 */
export type ZoneDriftSignals = { count: number; firewallOff: ReadonlySet<string>; cluster?: string }

/**
 * The drifts of a zone (its own, or of one of its members) from the engine's drifts list, the ignored ones left out as
 * the Drifts sub-tab leaves them out, so the count matches its list; null while the engine has not computed them.
 * `driftsCluster` is the connection the drifts were read from: a guest drift then concerns that cluster's member only,
 * never a member of another cluster with the same type and VMID.
 */
export function zoneDriftSignals(
  zone: MicrosegZone, members: readonly ZoneMember[], drifts: readonly MicrosegDrift[] | null, zones: MicrosegZone[], ignored: ReadonlySet<string>,
  driftsCluster?: string,
): ZoneDriftSignals | null {
  if (!drifts) return null
  // A drift merged from several clusters carries its own (`connection_id`); else it is of `driftsCluster`, else of
  // whichever member has its type and VMID (a caller that named no cluster).
  const clusterOf = (d: MicrosegDrift) => (d as { connection_id?: string }).connection_id || driftsCluster
  const byId = new Set(members.map(memberId))
  const idsOf = (d: MicrosegDrift): string[] => {
    if (!d.guest) return []
    const cluster = clusterOf(d)
    if (cluster !== undefined) {
      const id = clusterGuestId(cluster, d.guest.type, d.guest.vmid)
      return byId.has(id) ? [id] : []
    }
    const key = guestKey(d.guest)
    return members.filter(m => guestKey(m.ref) === key).map(memberId)
  }
  const mine = drifts.filter(d => !ignored.has(driftKey(d)) && (zoneOfDrift(d, zones)?.id === zone.id || idsOf(d).length > 0))
  const firewallOff = new Set(mine.filter(d => d.kind === 'nic_firewall_off').flatMap(idsOf))
  return driftsCluster === undefined ? { count: mine.length, firewallOff } : { count: mine.length, firewallOff, cluster: driftsCluster }
}

/** True when the drifts say the member's NIC firewall is off (a member of another cluster than the drifts' never is). */
export function isFirewallOff(signals: ZoneDriftSignals | null | undefined, member: Pick<ZoneMember, 'connectionId' | 'ref'>): boolean {
  if (!signals) return false
  return signals.firewallOff.has(memberId(member))
}

/**
 * The pending observed flows towards a zone and the outbound ones it emits (learned, not accepted nor dismissed yet), the
 * busiest first. An outbound flow carries its emitting zone in `src_zone_id` (`src_key` on older data).
 */
export function zoneSuggestions(suggestions: readonly MicrosegSuggestion[], zoneId: string): MicrosegSuggestion[] {
  return suggestions
    .filter(s => s.status === 'pending' && (s.dst_zone_id === zoneId || (s.direction === 'out' && (s.src_zone_id || s.src_key) === zoneId)))
    .sort((a, b) => b.hits - a.hits || (a.id < b.id ? -1 : 1))
}
