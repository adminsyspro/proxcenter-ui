/**
 * VLANs offered in the "VLAN trunks" picker of a guest NIC, per bridge. Pure:
 * the network-choices route feeds it what it already reads (the node's
 * interfaces, the SDN zones and VNets, the vDC VLAN pools).
 */

export type TrunkVlanSource = 'bridge' | 'iface' | 'sdn' | 'vdc'

/** One VLAN or range ('200', '100-199') and where it comes from. */
export type TrunkVlanChoice = { value: string; source: TrunkVlanSource; label?: string }

type PveIface = Record<string, unknown>
type SdnZone = { zone?: unknown; type?: unknown; bridge?: unknown }
type SdnVnet = { vnet?: unknown; zone?: unknown; tag?: unknown; alias?: unknown }
type VlanPool = { bridge: string; rangeStart: number; rangeEnd: number; vdcName?: string | null }

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const VLAN_TOKEN = /^(\d+)(?:-(\d+))?$/

function validToken(token: string): boolean {
  const m = VLAN_TOKEN.exec(token)
  if (!m) return false
  const start = Number(m[1])
  const end = m[2] === undefined ? start : Number(m[2])
  return start >= 1 && end <= 4094 && start <= end
}

/**
 * Whether Proxmox VE accepts trunks on a NIC of this bridge. A Linux bridge
 * must be VLAN aware ("vlan aware feature need to be enabled to use trunks",
 * PVE/Network.pm, the guest does not start); an OVS bridge always carries
 * them. Unknown for anything else (undefined): the dialog does not block.
 */
export function bridgeAcceptsTrunks(ifc: PveIface): boolean | undefined {
  if (ifc.type === 'OVSBridge') return true
  if (ifc.type === 'bridge') return Number(ifc.bridge_vlan_aware) === 1
  return undefined
}

/** Trunk VLANs known for `bridge`, deduplicated, in the order: bridge, interfaces, SDN, vDC pools. */
export function trunkVlanChoices(
  bridge: string,
  { ifaces = [], zones = [], vnets = [], pools = [] }: { ifaces?: PveIface[]; zones?: SdnZone[]; vnets?: SdnVnet[]; pools?: VlanPool[] },
): TrunkVlanChoice[] {
  const out: TrunkVlanChoice[] = []
  const seen = new Set<string>()
  const add = (value: string, source: TrunkVlanSource, label?: string) => {
    const key = `${source} ${value} ${label ?? ''}`
    if (!validToken(value) || seen.has(key)) return
    seen.add(key)
    out.push(label ? { value, source, label } : { value, source })
  }

  const own = ifaces.find(i => i.iface === bridge)
  // bridge-vids of a VLAN aware bridge: the VLANs it carries ("2-4094", "10 20 30-40").
  if (own && Number(own.bridge_vlan_aware) === 1) {
    for (const token of str(own.bridge_vids).split(/[\s,;]+/).filter(Boolean)) add(token, 'bridge')
  }
  // VLAN interfaces of the host on this bridge (vmbr0.4000).
  for (const ifc of ifaces) {
    if (ifc.type !== 'vlan') continue
    const name = str(ifc.iface)
    const raw = str(ifc['vlan-raw-device']) || (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '')
    const id = str(ifc['vlan-id']) || (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '')
    if (raw === bridge && id) add(id, 'iface', name)
  }
  // VNets of the SDN VLAN zones built on this bridge: named VLANs.
  const zonesOnBridge = new Set(zones.filter(z => z.type === 'vlan' && z.bridge === bridge).map(z => str(z.zone)))
  for (const v of vnets) {
    if (!zonesOnBridge.has(str(v.zone)) || !str(v.tag)) continue
    add(str(v.tag), 'sdn', str(v.alias) || str(v.vnet))
  }
  // VLAN pools the vDCs hold on this bridge.
  for (const p of pools) {
    if (p.bridge !== bridge) continue
    add(p.rangeStart === p.rangeEnd ? String(p.rangeStart) : `${p.rangeStart}-${p.rangeEnd}`, 'vdc', p.vdcName ?? undefined)
  }
  return out
}
