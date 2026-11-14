import type { MicrosegZone } from '@/lib/microseg/types'

/**
 * The zones whose gateway an address is, by name: the map and the Observation sub-tab name it instead of showing a
 * bare address in Unknown / External. Several zones of one network share their gateway.
 */
export function gatewayZones(zones: readonly Pick<MicrosegZone, 'name' | 'gateway'>[], ip: string): string[] {
  if (!ip) return []
  const bare = ip.replace(/\/(32|128)$/, '')
  return zones.filter(z => z.gateway && z.gateway === bare).map(z => z.name).sort((a, b) => a.localeCompare(b))
}

/** The gateway name of every address that is one, for a lookup by address. */
export function gatewayNameMap(zones: readonly Pick<MicrosegZone, 'name' | 'gateway'>[], name: (zones: string) => string): Map<string, string> {
  const out = new Map<string, string>()
  for (const ip of new Set(zones.map(z => z.gateway ?? '').filter(Boolean))) out.set(ip, name(gatewayZones(zones, ip).join(', ')))
  return out
}

/** An address as a flow shows it: "Gateway of web (10.30.0.1)" for a gateway, the address alone otherwise. */
export function namedAddress(ip: string, gateways: ReadonlyMap<string, string>): string {
  const name = gateways.get(ip.replace(/\/(32|128)$/, ''))
  return name ? `${name} (${ip})` : ip
}
