/**
 * Pure mapper: flattens vDC rows (with their vnets + subnet) into a flat
 * option list for the blueprint bridge selector.
 *
 * No Prisma import — operates on plain objects so it is unit-testable
 * without a DB connection.
 */

export interface NetworkOptionSubnet {
  cidr: string
  gateway: string
  dnsServers: string[]
}

export interface NetworkOption {
  /** The 8-char PVE VNet id — the value stored in the blueprint's networkBridge */
  pveName: string
  /** Tenant-friendly name (falls back to pveName when displayName is null/empty) */
  displayName: string
  /** vDC slug, for disambiguation/display */
  vdc: string
  vdcId: string
  connectionId: string
  subnet: NetworkOptionSubnet | null
}

// Input row shape mirrors:
//   prisma.vdc.findMany({ include: { vnets: { include: { subnet: true } } } })
interface VdcRow {
  id: string
  slug: string
  connectionId: string
  vnets: Array<{
    pveName: string
    displayName: string | null
    subnet: { cidr: string; gateway: string; dnsServers: string | null } | null
  }>
}

function buildSubnet(
  raw: { cidr: string; gateway: string; dnsServers: string | null } | null,
): NetworkOptionSubnet | null {
  if (!raw) return null
  const dnsServers = raw.dnsServers
    ? raw.dnsServers.split(',').map(s => s.trim()).filter(Boolean)
    : []
  return { cidr: raw.cidr, gateway: raw.gateway, dnsServers }
}

/**
 * Flatten vDC rows into a flat NetworkOption list sorted by displayName.
 * Tolerates vDC rows with missing/empty vnets arrays.
 */
export function buildNetworkOptions(vdcRows: VdcRow[]): NetworkOption[] {
  const options: NetworkOption[] = []

  for (const vdc of vdcRows) {
    const vnets = vdc.vnets ?? []
    for (const vnet of vnets) {
      options.push({
        pveName: vnet.pveName,
        displayName: vnet.displayName || vnet.pveName,
        vdc: vdc.slug,
        vdcId: vdc.id,
        connectionId: vdc.connectionId,
        subnet: buildSubnet(vnet.subnet),
      })
    }
  }

  // Stable sort by displayName (locale-insensitive)
  options.sort((a, b) => {
    if (a.displayName < b.displayName) return -1
    if (a.displayName > b.displayName) return 1
    return 0
  })

  return options
}
