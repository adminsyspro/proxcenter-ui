import { pveFetch, type ProxmoxClientOptions } from "./client"
import { resolveManagementAddress } from "./resolveManagementIp"
import { extractPortFromUrl } from "./urlUtils"
import { setNodeIps } from "../cache/nodeIpCache"
import { orderedIps, persistNodeIps, type DiscoveredNodeIp } from "./nodeIpPersistence"

/**
 * Discover cluster node IPs via /nodes API and persist them for failover.
 * Lightweight version: only fetches /nodes and /nodes/{node}/network per node.
 * Does NOT fetch /nodes/{node}/status (saves one call per node vs the full nodes route).
 *
 * Returns the addresses now on file for the connection, verified management
 * addresses first (empty on failure).
 */
export async function discoverNodeIps(
  connOpts: ProxmoxClientOptions,
  connectionId: string
): Promise<string[]> {
  try {
    const nodes = await pveFetch<any[]>(connOpts, "/nodes")
    if (!nodes || !Array.isArray(nodes)) return []

    // /cluster/status is the only PVE surface that reports a member's IP even
    // when that member is offline, so it is the fallback for the per-node
    // lookup below. Without it a node that just died loses its IP here, and
    // with it its place in the failover candidate list: the recovery mechanism
    // would shed candidates exactly as the cluster degrades.
    //
    // That `ip` is the corosync link address (pmxcfs copies
    // nodelist.node.N.ring0_addr into .members), on many sites a dedicated
    // cluster network ProxCenter cannot reach: it is stored as a guess, tried
    // last and never over a management address (roadmap#51).
    const clusterIps = new Map<string, string>()
    try {
      const status = await pveFetch<any[]>(connOpts, "/cluster/status")
      for (const entry of status ?? []) {
        if (entry?.type === "node" && entry?.name && typeof entry?.ip === "string" && entry.ip) {
          clusterIps.set(String(entry.name), entry.ip)
        }
      }
    } catch {
      // Standalone node, a token without Sys.Audit on /, or a transient
      // failure: the per-node lookup still runs.
    }

    // Resolve management IPs in parallel
    const discovered = (
      await Promise.all(
        nodes.map(async (node: any): Promise<DiscoveredNodeIp | null> => {
          const nodeName = node.node || node.name
          if (!nodeName) return null
          const networks = await pveFetch<any[]>(
            connOpts,
            `/nodes/${encodeURIComponent(nodeName)}/network`
          ).catch(() => null)
          const address = resolveManagementAddress(networks)
          if (address) return { node: nodeName, ip: address.ip, verified: address.verified }
          // A dead node answers nothing here, hence the cluster-wide fallback.
          return { node: nodeName, ip: clusterIps.get(String(nodeName)) || null, verified: false }
        })
      )
    ).filter((e): e is DiscoveredNodeIp => e !== null)

    if (!discovered.some(e => e.ip)) return []

    let ips = orderedIps(discovered.map(e => ({ node: e.node, ip: e.ip, ipVerified: e.verified })))

    // Persist to DB
    try {
      const { prisma } = await import("../db/prisma")

      // ManagedHost rows follow the connection owner's tenant (see
      // lib/connections/assignment.ts): resolve it so an MSP-owned connection
      // never gets default-owned rows colliding with the owner's own upserts.
      const owner = await prisma.connection.findUnique({
        where: { id: connectionId },
        select: { tenantId: true },
      })
      const ownerTenantId = owner?.tenantId ?? "default"

      const persisted = await persistNodeIps(prisma, { connectionId, tenantId: ownerTenantId, nodes: discovered })
      // What is on file wins over what was just discovered: a management
      // address kept over a guess stays a candidate, and comes first.
      ips = persisted.ips
    } catch {}

    // Populate in-memory cache
    try {
      const port = extractPortFromUrl(connOpts.baseUrl)
      const protocol = new URL(connOpts.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(connectionId, ips, port, protocol)
    } catch {}

    console.log(`[failover] Discovered ${ips.length} node IPs for connection ${connectionId}: ${ips.join(", ")}`)
    return ips
  } catch (e: any) {
    console.error(`[failover] Node IP discovery failed for ${connectionId}:`, e?.message)
    return []
  }
}
