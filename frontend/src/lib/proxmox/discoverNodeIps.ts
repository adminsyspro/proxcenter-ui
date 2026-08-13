import { pveFetch, type ProxmoxClientOptions } from "./client"
import { resolveManagementIp } from "./resolveManagementIp"
import { extractPortFromUrl } from "./urlUtils"
import { setNodeIps } from "../cache/nodeIpCache"

/**
 * Discover cluster node IPs via /nodes API and persist them for failover.
 * Lightweight version: only fetches /nodes and /nodes/{node}/network per node.
 * Does NOT fetch /nodes/{node}/status (saves one call per node vs the full nodes route).
 *
 * Returns the discovered IPs array (empty on failure).
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
    const clusterIps = new Map<string, string>()
    try {
      const status = await pveFetch<any[]>(connOpts, "/cluster/status")
      for (const entry of status ?? []) {
        if (entry?.type === "node" && entry?.name && typeof entry?.ip === "string" && entry.ip) {
          clusterIps.set(String(entry.name), entry.ip)
        }
      }
    } catch {
      // Standalone node or a transient failure: the per-node lookup still runs.
    }

    // Resolve management IPs in parallel
    const entries = await Promise.all(
      nodes.map(async (node: any) => {
        const nodeName = node.node || node.name
        if (!nodeName) return null
        try {
          const networks = await pveFetch<any[]>(
            connOpts,
            `/nodes/${encodeURIComponent(nodeName)}/network`
          ).catch(() => null)
          // A dead node answers nothing here, hence the cluster-wide fallback.
          const ip = resolveManagementIp(networks) || clusterIps.get(String(nodeName)) || null
          return { node: nodeName, ip }
        } catch {
          return { node: nodeName, ip: clusterIps.get(String(nodeName)) || null }
        }
      })
    )

    const validEntries = entries.filter(
      (e): e is { node: string; ip: string } => e !== null && typeof e.ip === "string"
    )

    if (validEntries.length === 0) return []

    // Populate in-memory cache
    const ips = validEntries.map(e => e.ip)
    try {
      const port = extractPortFromUrl(connOpts.baseUrl)
      const protocol = new URL(connOpts.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(connectionId, ips, port, protocol)
    } catch {}

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

      const liveNodeNames: string[] = []
      await Promise.all(
        entries.filter(e => e !== null).map((e) => {
          liveNodeNames.push(e!.node)
          return prisma.managedHost.upsert({
            where: { connectionId_node: { connectionId, node: e!.node } },
            // A discovery that came back empty leaves the stored IP alone
            // rather than nulling it. Overwriting a known-good IP with null on
            // a transient failure removes the node from the failover candidate
            // list, which is the one moment the list matters.
            update: e!.ip ? { ip: e!.ip } : {},
            create: { connectionId, node: e!.node, ip: e!.ip || null, tenantId: ownerTenantId },
          })
        })
      )
      // Cleanup stale entries for nodes no longer in the cluster
      if (liveNodeNames.length > 0) {
        await prisma.managedHost.deleteMany({
          where: { connectionId, node: { notIn: liveNodeNames } },
        })
      }
    } catch {}

    console.log(`[failover] Discovered ${ips.length} node IPs for connection ${connectionId}: ${ips.join(", ")}`)
    return ips
  } catch (e: any) {
    console.error(`[failover] Node IP discovery failed for ${connectionId}:`, e?.message)
    return []
  }
}
