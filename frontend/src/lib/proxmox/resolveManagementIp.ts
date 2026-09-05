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
 * Resolve the management IP from Proxmox node network interfaces.
 *
 * Works with both Linux bridges (vmbr0 with IP) and OVS setups
 * (OVSIntPort with gateway, e.g. "mgmt" interface).
 *
 * Priority:
 *  1. Interface with a gateway (always the management interface)
 *  2. vmbr0 with an IP (standard Linux bridge setup)
 *  3. Any vmbr* with an IP
 *  4. First active interface with an IP
 */
export function resolveManagementIp(networks: any[]): string | undefined {
  if (!Array.isArray(networks)) return undefined

  const active = networks.filter(
    (iface: any) => iface.address && !iface.address.startsWith('127.')
  )

  if (active.length === 0) return undefined

  // 1. Interface with a gateway defined → management interface
  const withGateway = active.find((i: any) => i.gateway || i.gateway6)
  if (withGateway?.address) return withGateway.address

  // 2. vmbr0 specifically (standard Linux bridge setup)
  const vmbr0 = active.find((i: any) => i.iface === 'vmbr0')
  if (vmbr0?.address) return vmbr0.address

  // 3. Any bridge interface with an IP
  const bridge = active.find((i: any) => i.iface?.startsWith('vmbr'))
  if (bridge?.address) return bridge.address

  // 4. First interface with an IP
  return active[0].address
}
