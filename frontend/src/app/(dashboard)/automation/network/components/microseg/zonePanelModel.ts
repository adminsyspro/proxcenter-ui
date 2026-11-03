import type { MicrosegDrift, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { zoneOfDrift } from './driftLabels'
import { guestKey, type ZoneMember } from './zoneModel'

/** What the Posture section of a zone panel says: members by status, those whose NIC firewall is off, the drifts. */
export type ZonePosture = { running: number; stopped: number; firewallOff: number; drifts: number }

/**
 * The posture of a zone from what the tab already holds (the guest list, the engine's drifts; no new read): members
 * running and stopped, members the engine found with their NIC firewall off, and the drifts of the zone (its own, or
 * of one of its members). Drifts are null while the engine has not computed them.
 */
export function zonePosture(zone: MicrosegZone, members: readonly ZoneMember[], drifts: readonly MicrosegDrift[] | null, zones: MicrosegZone[]): ZonePosture & { driftsKnown: boolean } {
  const keys = new Set(members.map(m => guestKey(m.ref)))
  const running = members.filter(m => m.guest?.status === 'running').length
  const stopped = members.filter(m => m.guest && m.guest.status !== 'running').length
  const mine = (drifts ?? []).filter(d => zoneOfDrift(d, zones)?.id === zone.id || (!!d.guest && keys.has(guestKey(d.guest))))
  const firewallOff = new Set(mine.filter(d => d.kind === 'nic_firewall_off' && d.guest).map(d => guestKey(d.guest!))).size
  return { running, stopped, firewallOff, drifts: mine.length, driftsKnown: drifts !== null }
}

/** The pending observed flows towards a zone (learned, not accepted nor dismissed yet), the busiest first. */
export function zoneSuggestions(suggestions: readonly MicrosegSuggestion[], zoneId: string): MicrosegSuggestion[] {
  return suggestions
    .filter(s => s.status === 'pending' && s.dst_zone_id === zoneId)
    .sort((a, b) => b.hits - a.hits || (a.id < b.id ? -1 : 1))
}
