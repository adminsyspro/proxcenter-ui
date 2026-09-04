/**
 * Network segment resolution for a single guest NIC.
 *
 * A guest NIC names its segment in three mutually exclusive ways, and reading
 * only the first one is what made SDN invisible to /infrastructure/topology:
 *
 *  1. SDN VNet: `net0=virtio=...,bridge=v42fc503`. The NIC carries NO `tag=` at
 *     all; the segment id lives on the VNet (`/cluster/sdn/vnets`) and its
 *     meaning (VLAN id vs VXLAN VNI) on the VNet's zone (`/cluster/sdn/zones`).
 *  2. VLAN-aware bridge: `bridge=vmbr0,tag=137`, the tag is on the NIC.
 *  3. Traditional layout: `bridge=vmbr1` where a `bondX.N` sub-interface feeds
 *     that bridge, so the VLAN lives in the node's host network config.
 *
 * A VNet wins over a per-NIC tag: the VNet is the real L2 domain, and that is
 * how the inventory Network view and the firewall VM rules table already bucket
 * a guest. Two VNets in DIFFERENT zones may legitimately carry the same tag on
 * the same bridge (PVE only enforces tag uniqueness inside one zone), so the
 * group key is the VNet id, never the tag.
 *
 * See sdnVnetMap.ts for the VNet/zone join this consumes and hostVlanMap.ts for
 * the bridge-to-VLAN map behind case 3.
 */

import { resolveEffectiveTag } from './hostVlanMap'
import { sdnSegmentLabel, type SdnVnet } from './sdnVnetMap'

/**
 * Group key of the segment-less bucket. Kept as the historical `no-vlan` string
 * so a client that already renders that bucket needs no migration.
 */
export const NO_SEGMENT_KEY = 'no-vlan'

/** Display label of the segment-less bucket. Translated at the render site. */
export const NO_SEGMENT_LABEL = 'No VLAN'

/** The segment a guest NIC rides, resolved from the three PVE models above. */
export type NicSegment = {
  /** Grouping key: `vnet-<id>`, `vlan-<n>`, or NO_SEGMENT_KEY. */
  key: string
  /** Display label: "VLAN 137", "VNI 4242", the VNet alias, or NO_SEGMENT_LABEL. */
  label: string
  /** The 802.1Q VLAN id the NIC really rides. Null for VXLAN/EVPN/simple zones. */
  vlan: number | null
  /** Segment id whatever its kind: a VLAN id, or a VXLAN VNI. Null when none. */
  tag: number | null
  /** Bridge as it should be shown: the VNet alias when the bridge is a VNet. */
  bridgeLabel: string
  /** VNet id, only when the bridge is an SDN VNet. */
  vnet?: string
  /** Zone id of that VNet. */
  zone?: string
  /** Zone type of that VNet: 'vlan' | 'vxlan' | 'qinq' | 'evpn' | 'simple' | ''. */
  zoneType?: string
}

/** Index resolved VNets by their id, so a NIC bridge can be matched in O(1). */
export function buildVnetIndex(vnets: SdnVnet[] | null | undefined): Map<string, SdnVnet> {
  const byId = new Map<string, SdnVnet>()
  if (!Array.isArray(vnets)) return byId

  for (const v of vnets) {
    if (v && typeof v.vnet === 'string' && v.vnet.length > 0) byId.set(v.vnet, v)
  }

  return byId
}

/** Whether a zone type carries an 802.1Q VLAN id rather than an overlay VNI. */
function isVlanZone(zoneType: string): boolean {
  return zoneType === 'vlan' || zoneType === 'qinq'
}

/**
 * Resolve one NIC's segment. `vnetById` is empty when SDN is unavailable or out
 * of the caller's scope, and `bridgeVlanMap` is empty when the node's host
 * network could not be read: in both cases resolution degrades to the per-NIC
 * tag, exactly the behaviour that predates this helper.
 */
export function resolveNicSegment(
  nic: { bridge?: string | null; tag?: number | null },
  vnetById: Map<string, SdnVnet>,
  bridgeVlanMap: Map<string, number>,
): NicSegment {
  const bridge = nic.bridge || ''

  const vnet = bridge ? vnetById.get(bridge) : undefined
  if (vnet) {
    const name = vnet.alias || vnet.vnet
    const tag = vnet.tag ?? null

    const segment: NicSegment = {
      key: `vnet-${vnet.vnet}`,
      label: sdnSegmentLabel(vnet) || name,
      vlan: isVlanZone(vnet.zoneType) ? tag : null,
      tag,
      bridgeLabel: name,
      vnet: vnet.vnet,
      zone: vnet.zone,
      zoneType: vnet.zoneType,
    }

    return segment
  }

  // 0 and negatives are not VLAN ids: PVE writes no `tag=` for an untagged NIC,
  // so a bogus value must not shadow the host-bridge fallback.
  const nicTag = Number.isInteger(nic.tag) && (nic.tag as number) > 0 ? (nic.tag as number) : undefined
  const effective = resolveEffectiveTag(nicTag, bridge, bridgeVlanMap)
  if (effective !== undefined) {
    return {
      key: `vlan-${effective}`,
      label: `VLAN ${effective}`,
      vlan: effective,
      tag: effective,
      bridgeLabel: bridge || 'unknown',
    }
  }

  return {
    key: NO_SEGMENT_KEY,
    label: NO_SEGMENT_LABEL,
    vlan: null,
    tag: null,
    bridgeLabel: bridge || 'unknown',
  }
}
