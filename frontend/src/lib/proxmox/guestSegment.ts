/**
 * Network segment resolution for a guest, as the firewall VM rules table groups it.
 *
 * The table used to read the per-NIC `tag=` alone, so every guest attached to an
 * SDN VNet (`net0=virtio=...,bridge=v42fc503`) landed under "Untagged": a VNet
 * carries its segment id (VXLAN VNI, VLAN, ...) on the VNet itself, never on the
 * guest NIC. These helpers parse a guest config once (the NIC list drives the
 * firewall flag, the VLAN list and the grouping alike), then resolve the first NIC
 * that names a segment, VNet first, mirroring the inventory Network view.
 *
 * See sdnVnetMap.ts for the VNet/zone join this consumes.
 */

import type { SdnVnet } from './sdnVnetMap'

/** A guest NIC, reduced to what firewall grouping and status need. */
export type GuestNic = {
  /** `net<N>` index, used to order NICs so `net0` is the primary one. */
  index: number
  bridge?: string
  /** Per-NIC VLAN tag; absent when the NIC carries none (0 is not a VLAN). */
  tag?: number
  firewall?: boolean
}

/** The segment a guest rides, as the VM rules table buckets it. */
export type GuestSegment =
  | { kind: 'vlan'; tag: number }
  | { kind: 'vnet'; vnet: SdnVnet }
  | { kind: 'untagged' }

/**
 * Group key of the untagged bucket. A sentinel rather than an empty string so it
 * can never collide with a `vlan:`/`vnet:` key built from PVE data.
 */
export const UNTAGGED_KEY = '__untagged__'

/**
 * Parse the NICs out of a guest config (`net0`, `net1`, ... as PVE returns them:
 * `virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=100,firewall=1`). Unknown keys are
 * ignored, so an unparsable NIC still yields an entry with no bridge and no tag.
 * Sorted by NIC index. Null-safe.
 */
export function parseGuestNics(config: Record<string, unknown> | null | undefined): GuestNic[] {
  if (!config || typeof config !== 'object') return []

  const nics: GuestNic[] = []
  for (const [key, raw] of Object.entries(config)) {
    const m = /^net(\d+)$/.exec(key)
    if (!m || typeof raw !== 'string') continue

    const nic: GuestNic = { index: Number.parseInt(m[1], 10) }
    for (const part of raw.split(',')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const field = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()

      if (field === 'bridge') {
        if (value) nic.bridge = value
      } else if (field === 'tag') {
        const tag = Number.parseInt(value, 10)
        if (Number.isInteger(tag) && tag > 0) nic.tag = tag
      } else if (field === 'firewall') {
        nic.firewall = value === '1'
      }
    }
    nics.push(nic)
  }

  return nics.sort((a, b) => a.index - b.index)
}

/** Unique per-NIC VLAN tags of a guest, ascending. */
export function nicVlanTags(nics: GuestNic[]): number[] {
  const tags = new Set<number>()
  for (const nic of nics) {
    if (nic.tag !== undefined) tags.add(nic.tag)
  }

  return [...tags].sort((a, b) => a - b)
}

/** Whether the firewall is enabled on at least one of the guest's NICs. */
export function hasNicFirewall(nics: GuestNic[]): boolean {
  return nics.some(nic => nic.firewall === true)
}

/**
 * Resolve the segment a guest is grouped under: the first NIC (by index) that
 * names one wins, so a guest keeps the grouping it had before VNets were
 * resolved. Within a NIC, an SDN VNet beats the per-NIC tag: the VNet is the
 * real L2 domain, and that is how the inventory Network view already buckets it.
 */
export function resolveGuestSegment(nics: GuestNic[], vnetById: Map<string, SdnVnet>): GuestSegment {
  for (const nic of nics) {
    const vnet = nic.bridge ? vnetById.get(nic.bridge) : undefined
    if (vnet) return { kind: 'vnet', vnet }
    if (nic.tag !== undefined) return { kind: 'vlan', tag: nic.tag }
  }

  return { kind: 'untagged' }
}

/**
 * Group key of a guest. Falls back to the primary VLAN when no segment was
 * resolved, so a payload predating segment resolution still groups as it did.
 */
export function guestSegmentKey(segment: GuestSegment | undefined, vlans: number[]): string {
  if (segment?.kind === 'vnet') return `vnet:${segment.vnet.vnet}`
  if (segment?.kind === 'vlan') return `vlan:${segment.tag}`
  if (!segment && vlans.length > 0) return `vlan:${vlans[0]}`

  return UNTAGGED_KEY
}

/** The VLAN id of a `vlan:<n>` group key, or null for any other key. */
export function vlanOfSegmentKey(key: string): number | null {
  if (!key.startsWith('vlan:')) return null
  const tag = Number.parseInt(key.slice('vlan:'.length), 10)

  return Number.isInteger(tag) ? tag : null
}
