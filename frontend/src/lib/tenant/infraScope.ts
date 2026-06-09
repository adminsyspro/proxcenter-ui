import { prisma } from "@/lib/db/prisma"
import { getVdcScope, type VdcScope } from "@/lib/vdc/scope"

import { DEFAULT_TENANT_ID } from "./constants"

/**
 * Tri-modal infrastructure scope for a tenant.
 *  - provider: the default tenant. Sees ALL connections, no masking.
 *  - iaas:     non-default tenant that slices provider clusters via vDCs.
 *  - msp:      non-default tenant that directly owns whole connections
 *              (Connection.tenant_id = tenantId); full-cluster view of those.
 */
export type InfraScope =
  | { kind: "provider" }
  | { kind: "iaas"; vdcScope: VdcScope }
  | { kind: "msp"; connectionIds: Set<string> }

/**
 * Resolve a tenant's infrastructure scope. Uses the global prisma client
 * (operatingModel + ownership are not tenant-scoped lookups).
 */
export async function getTenantInfrastructureScope(tenantId: string): Promise<InfraScope> {
  if (tenantId === DEFAULT_TENANT_ID) return { kind: "provider" }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { operatingModel: true },
  })

  if (tenant?.operatingModel === "msp") {
    const conns = await prisma.connection.findMany({
      where: { tenantId },
      select: { id: true },
    })
    return { kind: "msp", connectionIds: new Set(conns.map((c) => c.id)) }
  }

  const vdcScope = await getVdcScope(tenantId)
  return { kind: "iaas", vdcScope: vdcScope as VdcScope }
}

/**
 * PVE connection IDs a tenant may see, or null = no restriction (provider).
 */
export function pveConnectionFilter(infra: InfraScope): Set<string> | null {
  switch (infra.kind) {
    case "provider":
      return null
    case "iaas":
      return infra.vdcScope.connectionIds
    case "msp":
      return infra.connectionIds
  }
}

/**
 * The vDC scope used for node/pool/storage/namespace MASKING within a cluster,
 * or null = no masking (provider + msp see full clusters; only iaas is masked).
 */
export function maskingScope(infra: InfraScope): VdcScope | null {
  return infra.kind === "iaas" ? infra.vdcScope : null
}

/**
 * Whether a tenant may run a migration touching the given connection ids.
 * Provider: always. MSP: only if it owns EVERY involved connection. iaas: never
 * (migration is a whole-cluster operation, not vDC-scoped).
 */
export function canMigrateConnections(infra: InfraScope, ...connectionIds: string[]): boolean {
  if (infra.kind === "provider") return true
  if (infra.kind === "msp") return connectionIds.every((id) => infra.connectionIds.has(id))
  return false
}

export type InventoryConnClient = "global" | "session"

export interface InventoryConnectionPlan {
  /** Prisma client for the PVE connection query. */
  pveClient: InventoryConnClient
  /** Restrict PVE connections to these ids, or null = no id filter. */
  pveConnectionIds: string[] | null
  /** Prisma client for the PBS + external-hypervisor queries. */
  pbsExtClient: InventoryConnClient
}

/**
 * How the inventory routes should load connections for a tenant.
 *  - provider: global client, every connection.
 *  - msp:      session (tenant-scoped) client -> the tenant's own connections.
 *  - iaas:     global client filtered to the vDC-referenced PVE connections;
 *              PBS/external via the session client (preserves today's behavior;
 *              the stream route additionally surfaces vDC-bound PBS itself).
 */
export function inventoryConnectionPlan(infra: InfraScope): InventoryConnectionPlan {
  switch (infra.kind) {
    case "provider":
      return { pveClient: "global", pveConnectionIds: null, pbsExtClient: "global" }
    case "msp":
      return { pveClient: "session", pveConnectionIds: null, pbsExtClient: "session" }
    case "iaas":
      return { pveClient: "global", pveConnectionIds: [...infra.vdcScope.connectionIds], pbsExtClient: "session" }
  }
}
