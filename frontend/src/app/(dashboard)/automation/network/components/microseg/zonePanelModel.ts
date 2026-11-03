import type { MicrosegDrift, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { driftKey, zoneOfDrift } from './driftLabels'
import { guestKey, type ZoneMember } from './zoneModel'

/** What the engine's drifts tell of a zone in its panel: how many concern it, and the members with their NIC firewall off. */
export type ZoneDriftSignals = { count: number; firewallOff: ReadonlySet<string> }

/**
 * The drifts of a zone (its own, or of one of its members) from the engine's drifts list, the ignored ones left out as
 * the Drifts sub-tab leaves them out, so the count matches its list; null while the engine has not computed them.
 */
export function zoneDriftSignals(
  zone: MicrosegZone, members: readonly ZoneMember[], drifts: readonly MicrosegDrift[] | null, zones: MicrosegZone[], ignored: ReadonlySet<string>,
): ZoneDriftSignals | null {
  if (!drifts) return null
  const keys = new Set(members.map(m => guestKey(m.ref)))
  const mine = drifts.filter(d => !ignored.has(driftKey(d)) && (zoneOfDrift(d, zones)?.id === zone.id || (!!d.guest && keys.has(guestKey(d.guest)))))
  return { count: mine.length, firewallOff: new Set(mine.filter(d => d.kind === 'nic_firewall_off' && d.guest).map(d => guestKey(d.guest!))) }
}

/** The pending observed flows towards a zone (learned, not accepted nor dismissed yet), the busiest first. */
export function zoneSuggestions(suggestions: readonly MicrosegSuggestion[], zoneId: string): MicrosegSuggestion[] {
  return suggestions
    .filter(s => s.status === 'pending' && s.dst_zone_id === zoneId)
    .sort((a, b) => b.hits - a.hits || (a.id < b.id ? -1 : 1))
}
