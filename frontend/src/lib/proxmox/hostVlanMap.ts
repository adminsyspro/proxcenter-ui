/**
 * Host-level VLAN resolution for the inventory Network view.
 *
 * Proxmox guests can land on a VLAN in two ways:
 *  - VLAN-aware-bridge model: the guest NIC carries a `tag=N` in its net string
 *    (handled upstream by parseNetString).
 *  - Traditional model: a VLAN sub-interface on a bond (`bondX.N`) feeds a
 *    dedicated bridge, and guests attach to that bridge with no per-NIC tag.
 *
 * The inventory Network view historically only saw the first model, so guests
 * using the traditional layout (discussion #389) all showed up as "Untagged".
 * These helpers derive a bridge -> VLAN map from the node's network config so an
 * untagged guest's effective VLAN can be resolved from the bridge it attaches to.
 */

/** Minimal shape of a Proxmox `/nodes/{node}/network` interface entry. */
export type HostNetIface = {
  iface: string
  type?: string
  bridge_ports?: string
  ovs_ports?: string
  'vlan-id'?: number | string
  vlan_id?: number | string
  bridge_vlan_aware?: number | boolean
  [key: string]: unknown
}

/**
 * Parse the VLAN id from a sub-interface name such as `bond0.10` or `eno1.100`.
 * Returns null when the name has no numeric VLAN suffix or the id is out of the
 * valid 1-4094 range. A bridge name like `vmbr0V10` is NOT a VLAN sub-interface
 * (no `.N` suffix), so it returns null on purpose.
 */
export function parseVlanTag(name: string): number | null {
  if (typeof name !== 'string') return null
  const m = /\.(\d+)$/.exec(name)
  if (!m) return null
  const id = Number.parseInt(m[1], 10)
  if (!Number.isInteger(id) || id < 1 || id > 4094) return null
  return id
}

/** The VLAN id an interface represents, preferring an explicit field over the name. */
function vlanIdOf(iface: HostNetIface): number | null {
  const explicit = iface['vlan-id'] ?? iface.vlan_id
  if (explicit != null && explicit !== '') {
    const id = Number.parseInt(String(explicit), 10)
    if (Number.isInteger(id) && id >= 1 && id <= 4094) return id
  }
  return parseVlanTag(iface.iface)
}

/**
 * Build a `bridgeName -> vlanId` map from a node's network interfaces.
 *
 * A bridge is mapped only when ALL of its uplink ports resolve to the SAME
 * single VLAN. A raw-trunk uplink (e.g. `bridge_ports bond0`, no `.N`) resolves
 * to nothing, so a genuinely multi-VLAN bridge is left unmapped and its untagged
 * guests correctly stay Untagged. Ambiguous (conflicting) ports are also skipped.
 */
export function buildBridgeVlanMap(ifaces: HostNetIface[]): Map<string, number> {
  const map = new Map<string, number>()
  if (!Array.isArray(ifaces)) return map

  // Index every interface by name -> its VLAN id (for ports that reference a
  // named vlan iface whose VLAN lives in an explicit field, not the name).
  const vlanByName = new Map<string, number>()
  for (const iface of ifaces) {
    if (!iface || typeof iface.iface !== 'string') continue
    const id = vlanIdOf(iface)
    if (id != null) vlanByName.set(iface.iface, id)
  }

  for (const iface of ifaces) {
    if (!iface || typeof iface.iface !== 'string') continue
    if (iface.type !== 'bridge' && iface.type !== 'OVSBridge') continue

    const raw = String(iface.bridge_ports ?? iface.ovs_ports ?? '').trim()
    if (!raw) continue
    const ports = raw.split(/\s+/).filter(Boolean)

    const vlans = new Set<number>()
    for (const port of ports) {
      const id = vlanByName.get(port) ?? parseVlanTag(port)
      if (id != null) vlans.add(id)
    }
    if (vlans.size === 1) map.set(iface.iface, [...vlans][0])
  }

  return map
}

/**
 * Resolve a guest NIC's effective VLAN: an explicit per-NIC tag always wins;
 * otherwise fall back to the host VLAN of the bridge it attaches to. Returns
 * undefined when neither is known (the guest is genuinely untagged).
 */
export function resolveEffectiveTag(
  nicTag: number | undefined,
  bridge: string | undefined,
  bridgeVlanMap: Map<string, number>,
): number | undefined {
  if (nicTag != null) return nicTag
  if (bridge) return bridgeVlanMap.get(bridge)
  return undefined
}

/**
 * Client-side boundary helper: fold each net's server-computed `effectiveTag`
 * into `tag` so the inventory VLAN grouping (tree, dashboard, detail panel)
 * resolves traditional `bondX.N`-bridge layouts instead of bucketing untagged
 * guests under Untagged. Applied once where the `/networks` payload is read so
 * every downstream grouping site stays a single `tag`-based code path. Null-safe.
 */
export function foldEffectiveVlanTags<T extends { tag?: number; effectiveTag?: number }>(
  nets: T[] | undefined,
): T[] {
  return (nets ?? []).map((n) => ({ ...n, tag: n.effectiveTag ?? n.tag }))
}
