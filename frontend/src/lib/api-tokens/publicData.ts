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
  /** From /nodes/{node}/status, the call the fan-out already makes (#925). */
  load1: number
  load5: number
  load15: number
  iowait: number
  swapUsed: number
  swapTotal: number
  rootfsUsed: number
  rootfsTotal: number
  cores: number
  /** Short version only: the raw value is `pve-manager/9.2.11/<commit>`, whose commit would churn the label. */
  pveVersion: string | null
  kernel: string | null
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
  /** Cumulative COUNTERS since guest start, not gauges (#925). */
  netIn: number
  netOut: number
  diskRead: number
  diskWritten: number
  cores: number
  /** PVE 9 host-side memory. 0 on an LXC, which reports none. */
  memHost: number
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

export type PublicStorageNode = { node: string; used: number; total: number }

export type PublicStorage = {
  connId: string
  connectionName: string
  storage: string
  type: string
  /**
   * A shared storage appears once PER NODE upstream, so summing raw rows
   * triples an RBD pool on a three node cluster. `aggregateStorage` has
   * already collapsed those, which is why this carries no node of its own:
   * per-node figures live in `nodes`, and only for non-shared storages.
   */
  shared: boolean
  used: number
  total: number
  enabled: boolean
  nodes: PublicStorageNode[]
}

export type PublicFleetView = {
  tenantId: string
  visible: Set<string>
  clusters: ClusterData[]
  nodes: PublicNode[]
  guests: PublicGuest[]
  pbsServers: PublicPbsServer[]
  storages: PublicStorage[]
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
        load1: Number(node.loadavg?.[0] || 0),
        load5: Number(node.loadavg?.[1] || 0),
        load15: Number(node.loadavg?.[2] || 0),
        iowait: Number(node.iowait || 0),
        swapUsed: Number(node.swapUsed || 0),
        swapTotal: Number(node.swapTotal || 0),
        rootfsUsed: Number(node.rootfsUsed || 0),
        rootfsTotal: Number(node.rootfsTotal || 0),
        cores: Number(node.cores || 0),
        // `pve-manager/9.2.11/<commit>` -> `9.2.11`. The commit would make the
        // label churn on every point release rebuild.
        pveVersion: typeof node.pveVersion === "string" ? (node.pveVersion.split("/")[1] || node.pveVersion) : null,
        kernel: typeof node.kernel === "string" && node.kernel !== "" ? node.kernel : null,
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
          netIn: Number(guest.netin || 0),
          netOut: Number(guest.netout || 0),
          diskRead: Number(guest.diskread || 0),
          diskWritten: Number(guest.diskwrite || 0),
          cores: Number(guest.cores || 0),
          memHost: Number(guest.memhost || 0),
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

  // Same TENANT BOUNDARY as clusters and PBS servers.
  const storages: PublicStorage[] = (raw.storages ?? [])
    .filter(entry => visible.has(entry.connId))
    .map(entry => ({
      connId: entry.connId,
      connectionName: entry.connName,
      storage: entry.storage,
      type: entry.type,
      shared: !!entry.shared,
      used: Number(entry.used || 0),
      total: Number(entry.total || 0),
      enabled: entry.enabled !== false,
      nodes: (entry.nodeBreakdown ?? []).map(n => ({
        node: n.node,
        used: Number(n.used || 0),
        total: Number(n.total || 0),
      })),
    }))

  return { tenantId, visible, clusters, nodes, guests, pbsServers, storages, cached }
}
