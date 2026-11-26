// The zone a CIDR side of a flow points at: a single-host CIDR that is the address of a zone member, as GET /ipfilter
// lists the members (the engine's memory of its last full run, no Proxmox call). The flow dialog offers that zone.

import type { IPFilterGuest, MicrosegZone } from '@/lib/microseg/types'

import { singleHost } from './zoneForm'

export type FlowZoneHint = { zoneId: string; zone: string; guest: string; addr: string }

/** Addresses every guest carries or none can be told apart by: unspecified and IPv6 link-local (fe80::/10). */
const technical = (addr: string) => addr === '0.0.0.0' || addr === '::' || /^fe[89ab][0-9a-f]:/i.test(addr)

/**
 * The zone of the member whose address `cidr` names, when exactly one zone of the draft holds that address. The
 * addresses an admin added by hand (`extra`) are left out: they are allowed to the guest, not its own. Null for a
 * network, an address no member has, an address members of several zones report, or a zone the draft no longer has.
 */
export function flowZoneHint(cidr: string, guests: readonly IPFilterGuest[], zones: readonly MicrosegZone[]): FlowZoneHint | null {
  const host = singleHost(cidr)
  if (!host || technical(host)) return null
  const byZone = new Map<string, string>()
  for (const g of guests) {
    if (!g.zone || byZone.has(g.zone)) continue
    const extra = new Set((g.extra ?? []).map(singleHost))
    const owns = Object.values(g.nics ?? {}).some(list => list.some(a => singleHost(a) === host && !extra.has(host)))
    if (owns) byZone.set(g.zone, g.name || String(g.vmid))
  }
  if (byZone.size !== 1) return null
  const [[name, guest]] = [...byZone]
  const zone = zones.find(z => z.name === name)
  return zone ? { zoneId: zone.id, zone: zone.name, guest, addr: host } : null
}
