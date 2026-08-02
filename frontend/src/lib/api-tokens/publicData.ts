// ONE shared fleet view for the three hand-written public endpoints (D12,
// spec section 8). A Prometheus/health/backups scrape reads the inventory
// through the SWR cache wrapper and NEVER amplifies to the hypervisor —
// unlike PegaProx's exporter, which walks /cluster/resources on every
// scrape (metrics_exporter.py:120-134, spec section 3 competitive
// analysis). A Prometheus server scrapes every 15s: any fan-out to
// Proxmox on this path would hammer the customer's cluster forever.
import type { Principal } from "@/lib/auth/principal"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { getInventorySWR, type ClusterData } from "@/lib/inventory/fetchRawInventory"

import { resolvePublicRequestScope } from "./scope"

export type PublicNode = {
  connId: string
  connectionName: string
  node: string
  status: string
  cpu: number
  mem: number
  maxmem: number
}

export type PublicGuest = {
  connId: string
  connectionName: string
  node: string
  vmid: string
  name: string
  type: string
  status: string
  cpu: number
  mem: number
  maxmem: number
  /**
   * Tri-state, NEVER a fabricated false: `fetchRawInventory`'s guest data
   * comes from /cluster/resources, which carries no agent config flag
   * (fetchRawInventory.ts:270-285) — the only clean source is a capped
   * /config pass, an open product question (D9-adjacent, not decided
   * here). true/false only when a producer genuinely supplies the flag;
   * otherwise null ("unknown"), so a consumer omits the sample rather
   * than publish a wrong "no agent" for a VM whose agent IS enabled.
   */
  agentEnabled: boolean | null
  template: boolean
}

export type PublicFleetView = {
  tenantId: string
  visible: Set<string>
  clusters: ClusterData[]
  nodes: PublicNode[]
  guests: PublicGuest[]
  cached: boolean
}

// Some producers of RawInventory guest data still carry Proxmox's raw
// `1`, others already normalize to a boolean (fetchRawInventory.ts:284);
// accept both rather than assume one shape.
function isTemplate(guest: any): boolean {
  return guest?.template === 1 || guest?.template === true
}

/**
 * Resolves tenant + connection perimeter via `resolvePublicRequestScope`,
 * reads the inventory through `getInventorySWR` — the cache wrapper, never
 * the hypervisor directly (D12) — filters clusters to the resolved
 * `visible` set (a TENANT BOUNDARY, not a display filter: a helper that
 * accepts this argument and never reads it is exactly the
 * `resolveVisibleConnectionIds` bug this chantier already shipped once),
 * and flattens nodes and guests. Templates are excluded from guests: they
 * are not real workloads and would silently inflate every published count.
 */
export async function loadPublicFleetView(principal?: Principal): Promise<PublicFleetView> {
  const { tenantId, visible } = await resolvePublicRequestScope(principal)
  const infra = await getTenantInfrastructureScope(tenantId)
  const { raw, cached } = await getInventorySWR(tenantId, infra)

  const clusters = raw.clusters.filter(cluster => visible.has(cluster.id))
  const nodes: PublicNode[] = []
  const guests: PublicGuest[] = []

  for (const cluster of clusters) {
    for (const node of cluster.nodes) {
      nodes.push({
        connId: cluster.id,
        connectionName: cluster.name,
        node: node.node,
        status: node.status,
        cpu: Number(node.cpu || 0),
        mem: Number(node.mem || 0),
        maxmem: Number(node.maxmem || 0),
      })
      for (const guest of node.guests as any[]) {
        if (isTemplate(guest)) continue
        guests.push({
          connId: cluster.id,
          connectionName: cluster.name,
          node: node.node,
          vmid: String(guest.vmid),
          name: guest.name || `${guest.type}/${guest.vmid}`,
          type: guest.type,
          status: guest.status,
          cpu: Number(guest.cpu || 0),
          mem: Number(guest.mem || 0),
          maxmem: Number(guest.maxmem || 0),
          agentEnabled: typeof guest.agentEnabled === "boolean" ? guest.agentEnabled : null,
          template: false,
        })
      }
    }
  }

  return { tenantId, visible, clusters, nodes, guests, cached }
}
