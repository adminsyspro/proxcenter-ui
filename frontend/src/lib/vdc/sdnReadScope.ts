import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

/**
 * VNets of a connection that the raw /connections/{id}/sdn/* routes may show
 * the caller (roadmap#81), or null for the whole cluster as PVE has it.
 *
 * The provider, and an msp tenant on a cluster it owns, read everything. A
 * vDC (iaas) tenant reaches a shared provider connection through its vDCs and
 * gets the VNets of those vDCs only, the same slice network-choices returns:
 * the cluster-wide objects (other tenants' VNets, IPAM allocations,
 * controllers, DNS, fabrics) are none of its business.
 */
export async function sdnOwnVnets(connectionId: string): Promise<Set<string> | null> {
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId(), { ignoreVdcContext: true })
  const scope = maskingScope(infra)
  if (!scope) return null
  return scope.vnetsByConnection.get(connectionId) ?? new Set<string>()
}

/** `vnets` restricted to `own`; null keeps the full list. */
export function keepOwnVnets<T extends { vnet?: unknown }>(vnets: T[], own: Set<string> | null): T[] {
  if (!own) return vnets
  return vnets.filter((v) => typeof v?.vnet === "string" && own.has(v.vnet))
}

/** Zones that hold at least one of `vnets` (already restricted to the caller). */
export function keepZonesOf<T extends { zone?: unknown }>(zones: T[], vnets: Array<{ zone?: unknown }>): T[] {
  const used = new Set(vnets.map((v) => v?.zone).filter((z): z is string => typeof z === "string"))
  return zones.filter((z) => typeof z?.zone === "string" && used.has(z.zone))
}
