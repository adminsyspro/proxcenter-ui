/**
 * SDN VNet resolution for the inventory Network view (provider scope).
 *
 * A guest whose NIC bridge is an SDN VNet (`net0=...,bridge=v42fc503`) carries no
 * per-NIC VLAN tag, so it used to fall under "Untagged". These helpers join the
 * cluster's VNets with their zones so the VNet can be shown as the guest's real
 * segment (VXLAN VNI, VLAN, ...). Distinct from hostVlanMap.ts: a VXLAN VNI is
 * NOT range-limited to 1-4094, so no VLAN range check is applied here.
 */

/** A Proxmox /cluster/sdn/zones entry (minimal shape). */
export type SdnZoneRaw = { zone: string; type?: string; peers?: string | string[]; [k: string]: unknown }
/** A Proxmox /cluster/sdn/vnets entry (minimal shape). */
export type SdnVnetRaw = { vnet: string; alias?: string; zone?: string; tag?: number | string; [k: string]: unknown }

/** A resolved SDN VNet: a vnet joined with its zone. */
export type SdnVnet = {
  vnet: string        // id, e.g. "v42fc503"
  alias?: string      // friendly name, e.g. "lan"
  zone: string        // zone id; '' when the vnet has no/unknown zone
  zoneType: string    // "vxlan" | "vlan" | "qinq" | "evpn" | "simple" | "" (unknown)
  tag?: number        // VLAN id (vlan/qinq) or VXLAN VNI (vxlan/evpn); undefined when absent/invalid
  peers?: string[]    // parsed peers, only for vxlan/evpn zones
}

/** Strict positive-integer coercion. Rejects "10abc", NaN, empty, 0, negatives. */
function toTag(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** Parse peers from a comma string or an already-normalized string[]. */
function toPeers(raw: unknown): string[] | undefined {
  let arr: string[]
  if (Array.isArray(raw)) arr = raw.map((p) => String(p))
  else if (typeof raw === 'string') arr = raw.split(',')
  else return undefined
  const cleaned = arr.map((s) => s.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Join `/cluster/sdn/vnets` with `/cluster/sdn/zones` by zone id. Unresolved
 * zones yield `zone`/`zoneType` sentinels of '' so a VNet-backed guest still
 * leaves "Untagged". Sorted by alias||vnet. Array/null-safe.
 */
export function buildSdnVnets(vnets: SdnVnetRaw[], zones: SdnZoneRaw[]): SdnVnet[] {
  if (!Array.isArray(vnets)) return []

  const zoneById = new Map<string, SdnZoneRaw>()
  if (Array.isArray(zones)) {
    for (const z of zones) {
      if (z && typeof z.zone === 'string') zoneById.set(z.zone, z)
    }
  }

  const out: SdnVnet[] = []
  for (const v of vnets) {
    if (!v || typeof v.vnet !== 'string') continue
    const zoneId = typeof v.zone === 'string' ? v.zone : ''
    const zone = zoneById.get(zoneId)
    const zoneType = zone && typeof zone.type === 'string' ? zone.type : ''

    const sv: SdnVnet = {
      vnet: v.vnet,
      zone: zoneId,
      zoneType,
      ...(typeof v.alias === 'string' && v.alias.length > 0 ? { alias: v.alias } : {}),
    }
    const tag = toTag(v.tag)
    if (tag !== undefined) sv.tag = tag
    if (zoneType === 'vxlan' || zoneType === 'evpn') {
      const peers = toPeers(zone?.peers)
      if (peers) sv.peers = peers
    }
    out.push(sv)
  }

  out.sort((a, b) => (a.alias || a.vnet).localeCompare(b.alias || b.vnet))
  return out
}

/** Segment-identifier text for a VNet, by zone type. "" when none applies. */
export function sdnSegmentLabel(v: SdnVnet): string {
  if (v.tag === undefined) return ''
  if (v.zoneType === 'vxlan' || v.zoneType === 'evpn') return `VNI ${v.tag}`
  if (v.zoneType === 'vlan' || v.zoneType === 'qinq') return `VLAN ${v.tag}`
  return ''
}
