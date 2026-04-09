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
          const ip = resolveManagementIp(networks) || null
          return { node: nodeName, ip }
        } catch {
          return { node: nodeName, ip: null }
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
      const liveNodeNames: string[] = []
      await Promise.all(
        entries.filter(e => e !== null).map((e) => {
          liveNodeNames.push(e!.node)
          return prisma.managedHost.upsert({
            where: { connectionId_node: { connectionId, node: e!.node } },
            update: { ip: e!.ip || null },
            create: { connectionId, node: e!.node, ip: e!.ip || null },
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
