import { isSearchableIp } from "@/lib/net/ip"

/**
 * Every address a node answers on (management, storage, Ceph public...),
 * loopback and link-local excluded. Feeds the node search of the command
 * palette (#861): an admin who only knows a storage-network IP still finds
 * the host. `/nodes/{node}/network` carries no MAC, so hosts are IP-only.
 */
export function collectNodeAddresses(networks: any[]): string[] {
  if (!Array.isArray(networks)) return []
  const out = new Set<string>()
  for (const iface of networks) {
    for (const raw of [iface?.address, iface?.address6]) {
      if (typeof raw !== 'string' || !raw) continue
      const ip = raw.split('/')[0]
      if (isSearchableIp(ip)) out.add(ip)
    }
  }
  return [...out]
}

/**
 * A node address with how much it can be trusted as the management address.
 * `verified` means it was read off the management interface itself; otherwise
 * it is the best guess the interface list allowed, and the failover store
 * never lets it replace a verified address (see nodeIpPersistence.ts).
 */
export type ManagementAddress = { ip: string; verified: boolean }

/** A Linux or OVS bridge, as opposed to a VLAN on one (vmbr0.4000). */
function isBridge(iface: any): boolean {
  if (iface?.type === 'bridge' || iface?.type === 'OVSBridge') return true
  // Answers without a type: match a bridge name, not a sub-interface of one.
  return typeof iface?.iface === 'string' && /^vmbr\d+$/.test(iface.iface)
}

/**
 * Resolve the management address from Proxmox node network interfaces.
 *
 * Works with both Linux bridges (vmbr0 with IP) and OVS setups
 * (OVSIntPort with gateway, e.g. "mgmt" interface).
 *
 * Verified, read from the management interface itself:
 *  1. Interface with a gateway (always the management interface)
 *  2. vmbr0 with an IP (the installer's management bridge)
 * A guess, when nothing above is listed:
 *  3. Any other bridge with an IP
 *  4. First active interface with an IP
 *
 * pve-manager removes every bridge from `/nodes/{node}/network` when the
 * token lacks SDN.Audit (or SDN.Use) on /sdn/zones/localnetwork, so such a
 * token sees neither the gateway interface nor vmbr0, only VLAN or storage
 * interfaces such as a VXLAN transport `vmbr0.4000`: case 4, an address that
 * is often not routed from ProxCenter (roadmap#51).
 */
export function resolveManagementAddress(networks: any[]): ManagementAddress | undefined {
  if (!Array.isArray(networks)) return undefined

  const active = networks.filter(
    (iface: any) => typeof iface?.address === 'string' && iface.address && !iface.address.startsWith('127.')
  )

  if (active.length === 0) return undefined

  // 1. Interface with a gateway defined → management interface
  const withGateway = active.find((i: any) => i.gateway || i.gateway6)
  if (withGateway?.address) return { ip: withGateway.address, verified: true }

  // 2. vmbr0 specifically (standard Linux bridge setup)
  const vmbr0 = active.find((i: any) => i.iface === 'vmbr0')
  if (vmbr0?.address) return { ip: vmbr0.address, verified: true }

  // 3. Any other bridge with an IP
  const bridge = active.find((i: any) => isBridge(i))
  if (bridge?.address) return { ip: bridge.address, verified: false }

  // 4. First interface with an IP
  return { ip: active[0].address, verified: false }
}

/** The management address alone, best guess included; see resolveManagementAddress. */
export function resolveManagementIp(networks: any[]): string | undefined {
  return resolveManagementAddress(networks)?.ip
}
