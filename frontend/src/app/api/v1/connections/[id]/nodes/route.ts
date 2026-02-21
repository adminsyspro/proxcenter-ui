import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { extractHostFromUrl, extractPortFromUrl } from "@/lib/proxmox/urlUtils"
import { setNodeIps } from "@/lib/cache/nodeIpCache"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  // RBAC: Check node.view permission
  const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", id)

  if (denied) return denied

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

  // Enrichir chaque node avec son IP et hastate
  const enrichedNodes = await Promise.all(
    (nodes || []).map(async (node: any) => {
      const nodeName = node.node || node.name

      if (!nodeName) return node

      let ip: string | null = null

      try {
        const networks = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(nodeName)}/network`
        )
        ip = resolveManagementIp(networks) || null
      } catch {
        // Pas d'accès aux interfaces réseau
      }

      return {
        ...node,
        ip,
        hastate: hastateMap[nodeName] || null,
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
      const protocol = new URL(conn.baseUrl).protocol.replace(":", "")
      setNodeIps(id, nodeIps, port, protocol)
    } catch {
      // Invalid baseUrl — skip cache population
    }
  }

  return NextResponse.json({ data: enrichedNodes, connectedNode })
}
