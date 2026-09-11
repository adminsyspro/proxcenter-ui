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
  /** Root filesystem of the HOST, not cluster storage capacity (#925). */
  disk: number
  maxdisk: number
  uptime: number
  /**
   * Reduced to a boolean on purpose: the raw Proxmox value is a free-form
   * mode name, and letting it through would hand an unbounded label value
   * to `proxcenter_node_maintenance`.
   */
  maintenance: boolean
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
  /** Provisioned disk size; `disk` itself is only meaningful for LXC (#925). */
  maxdisk: number
  uptime: number
  /** null when HA does not manage this guest, never a fabricated state (#925). */
  hastate: string | null
}

export type PublicPbsDatastore = {
  name: string
  /** 0 when the backend does not report a capacity, as with an S3-backed datastore. */
  total: number
  used: number
  available: number
  usagePercent: number
  backupCount: number
  vmCount: number
  ctCount: number
  hostCount: number
}

export type PublicPbsServer = {
  connId: string
  connectionName: string
  status: string
  version: string | null
  datastores: PublicPbsDatastore[]
}

export type PublicFleetView = {
  tenantId: string
  visible: Set<string>
  clusters: ClusterData[]
  nodes: PublicNode[]
  guests: PublicGuest[]
  pbsServers: PublicPbsServer[]
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
  // API-token path: never the view context — union infra + union cache key.
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  // nonBlocking (D12): a Prometheus scrape must never wait on a cold cache
  // fan-out to the hypervisor. See getInventorySWR's doc comment.
  const { raw, cached } = await getInventorySWR(tenantId, infra, false, true, null)

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
        disk: Number(node.disk || 0),
        maxdisk: Number(node.maxdisk || 0),
        uptime: Number(node.uptime || 0),
        maintenance: typeof node.maintenance === "string" && node.maintenance !== "",
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
          maxdisk: Number(guest.maxdisk || 0),
          uptime: Number(guest.uptime || 0),
          hastate: typeof guest.hastate === "string" && guest.hastate !== "" ? guest.hastate : null,
        })
      }
    }
  }

  // Same TENANT BOUNDARY as `clusters` above, never a display filter: a
  // helper that accepts this argument and never reads it is exactly the
  // `resolveVisibleConnectionIds` bug this chantier already shipped once.
  const pbsServers: PublicPbsServer[] = (raw.pbsServers ?? [])
    .filter(server => visible.has(server.id))
    .map(server => ({
      connId: server.id,
      connectionName: server.name,
      status: server.status,
      version: typeof server.version === "string" && server.version !== "" ? server.version : null,
      datastores: (server.datastores ?? []).map(datastore => ({
        name: datastore.name,
        total: Number(datastore.total || 0),
        used: Number(datastore.used || 0),
        available: Number(datastore.available || 0),
        usagePercent: Number(datastore.usagePercent || 0),
        backupCount: Number(datastore.backupCount || 0),
        vmCount: Number(datastore.vmCount || 0),
        ctCount: Number(datastore.ctCount || 0),
        hostCount: Number(datastore.hostCount || 0),
      })),
    }))

  return { tenantId, visible, clusters, nodes, guests, pbsServers, cached }
}
