import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { extractHostFromUrl, extractPortFromUrl } from "@/lib/proxmox/urlUtils"
import { setNodeIps } from "@/lib/cache/nodeIpCache"
import { getSessionPrisma } from "@/lib/tenant"

export const runtime = "nodejs"

// Short-lived response cache to avoid hammering PVE /nodes on every navigation.
// When a cluster has a dead node, PVE is slow to respond (~2-4s) due to corosync
// timeouts. This cache makes subsequent navigations within the same cluster instant.
const NODES_CACHE_KEY = "__proxcenter_nodes_response_cache__" as const
const NODES_CACHE_TTL = 30_000 // 30 seconds

function getNodesCache(): Map<string, { data: any; connectedNode: string | null; timestamp: number }> {
  if (!(globalThis as any)[NODES_CACHE_KEY]) {
    ;(globalThis as any)[NODES_CACHE_KEY] = new Map()
  }
  return (globalThis as any)[NODES_CACHE_KEY]
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const prisma = await getSessionPrisma()
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  // RBAC: Check node.view without resource context so scoped users (node/vm/tag/pool) pass.
  // Actual filtering happens after fetching.
  const denied = await checkPermission(PERMISSIONS.NODE_VIEW)
  if (denied) return denied

  // Check response cache
  const cache = getNodesCache()
  const cached = cache.get(id)
  if (cached && Date.now() - cached.timestamp < NODES_CACHE_TTL) {
    return NextResponse.json({ data: cached.data, connectedNode: cached.connectedNode })
  }

  const conn = await getConnectionById(id)

  // Fetch nodes and cluster resources in parallel (for maintenance hastate)
  const [nodes, clusterResources] = await Promise.all([
    pveFetch<any[]>(conn, `/nodes`, { method: "GET" }),
    pveFetch<any[]>(conn, `/cluster/resources?type=node`).catch(() => [] as any[]),
  ])

  // Build a map of node hastate from cluster resources
  const hastateMap: Record<string, string> = {}
  for (const res of (clusterResources || [])) {
    if (res?.node && res?.hastate) {
      hastateMap[res.node] = res.hastate
    }
  }

  // Enrichir chaque node avec son IP, hastate, et mémoire précise
  const enrichedNodes = await Promise.all(
    (nodes || []).map(async (node: any) => {
      const nodeName = node.node || node.name

      if (!nodeName) return node

      let ip: string | null = null
      let accurateMem: { used: number; total: number } | null = null

      try {
        // Fetch network and node status in parallel for each node
        const [networks, nodeStatus] = await Promise.all([
          pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`).catch(() => null),
          node.status === 'online'
            ? pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/status`).catch(() => null)
            : Promise.resolve(null),
        ])

        ip = resolveManagementIp(networks) || null

        // Detect bridge types (native Linux bridge vs OVS)
        if (networks && Array.isArray(networks)) {
          const bridges = networks.filter((iface: any) => iface.type === 'bridge' || iface.type === 'OVSBridge')
          const nativeBridges = bridges.filter((iface: any) => iface.type === 'bridge').map((iface: any) => iface.iface)
          const ovsBridges = bridges.filter((iface: any) => iface.type === 'OVSBridge').map((iface: any) => iface.iface)

          ;(node as any)._bridges = { native: nativeBridges, ovs: ovsBridges }
        }

        // Use memory from /nodes/{node}/status (excludes ZFS ARC / kernel caches)
        if (nodeStatus?.memory?.total > 0) {
          accurateMem = {
            used: Number(nodeStatus.memory.used || 0),
            total: Number(nodeStatus.memory.total || 0),
          }
        }
      } catch {
        // Pas d'accès aux interfaces réseau ou au status
      }

      return {
        ...node,
        ...(accurateMem ? { mem: accurateMem.used, maxmem: accurateMem.total } : {}),
        ip,
        hastate: hastateMap[nodeName] || null,
        bridges: (node as any)._bridges || null,
      }
    })
  )

  // Detect which node is the API endpoint (connectedNode)
  const baseHost = extractHostFromUrl(conn.baseUrl)
  let connectedNode: string | null = null

  if (baseHost) {
    for (const n of enrichedNodes) {
      if (n.ip && n.ip === baseHost) {
        connectedNode = n.node || n.name || null
        break
      }
    }
  }

  // Populate the node IP cache for failover
  const nodeIps = enrichedNodes
    .map((n: any) => n.ip)
    .filter((ip: any): ip is string => typeof ip === "string" && ip.length > 0)

  if (nodeIps.length > 0) {
    try {
      const port = extractPortFromUrl(conn.baseUrl)
      const protocol = new URL(conn.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(id, nodeIps, port, protocol)
    } catch {
      // Invalid baseUrl — skip cache population
    }
  }

  // Persist node IPs in DB for failover after restart
  const liveNodeNames: string[] = []
  try {
    await Promise.all(
      enrichedNodes.map((n: any) => {
        const nodeName = n.node || n.name
        if (!nodeName) return Promise.resolve()
        liveNodeNames.push(nodeName)
        return prisma.managedHost.upsert({
          where: { connectionId_node: { connectionId: id, node: nodeName } },
          update: { ip: n.ip || null },
          create: { connectionId: id, node: nodeName, ip: n.ip || null },
        })
      })
    )

    // Cleanup stale ManagedHost entries for nodes removed from the cluster
    if (liveNodeNames.length > 0) {
      await prisma.managedHost.deleteMany({
        where: { connectionId: id, node: { notIn: liveNodeNames } },
      })
    }
  } catch {
    // Non-blocking — don't break the API response
  }

  // Fetch SSH address overrides from ManagedHost
  let sshOverrides: Record<string, { sshAddress: string | null; hostId: string }> = {}
  try {
    const hosts = await prisma.managedHost.findMany({
      where: { connectionId: id },
      select: { id: true, node: true, sshAddress: true },
    })
    for (const h of hosts) {
      sshOverrides[h.node] = { sshAddress: h.sshAddress, hostId: h.id }
    }
  } catch {}

  const nodesWithSsh = enrichedNodes.map((n: any) => ({
    ...n,
    sshAddress: sshOverrides[n.node || n.name]?.sshAddress || null,
    hostId: sshOverrides[n.node || n.name]?.hostId || null,
  }))

  // Cache the response for 30s
  cache.set(id, { data: nodesWithSsh, connectedNode, timestamp: Date.now() })

  return NextResponse.json({ data: nodesWithSsh, connectedNode })
}
