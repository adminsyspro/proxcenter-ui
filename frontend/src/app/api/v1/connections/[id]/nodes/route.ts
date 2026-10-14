import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveManagementAddress } from "@/lib/proxmox/resolveManagementIp"
import { orderedIps, persistNodeIps } from "@/lib/proxmox/nodeIpPersistence"
import { extractHostFromUrl, extractPortFromUrl } from "@/lib/proxmox/urlUtils"
import { setNodeIps } from "@/lib/cache/nodeIpCache"
import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

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

  // Resolve tenant for vDC-aware caching and filtering
  const tenantId = await getCurrentTenantId()

  // The 30s response cache must not serve an MSP-owned cluster's node list,
  // fetched by an authorized NOC user, to a narrowly scoped default-tenant
  // user. The caller's connection-scoped view grant is part of the key;
  // getConnectionById enforces the actual access.
  const fleetView =
    tenantId === DEFAULT_TENANT_ID &&
    (await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)) === null
  const cacheKey = `${tenantId}:${fleetView ? "fleet" : "scoped"}:${id}`

  // Check response cache (keyed by tenant + access scope to avoid leaks)
  const cache = getNodesCache()
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < NODES_CACHE_TTL) {
    return NextResponse.json({ data: cached.data, connectedNode: cached.connectedNode })
  }

  const conn = await getConnectionById(id)

  // ManagedHost rows follow the connection owner's tenant (see lib/connections/
  // assignment.ts). When the provider visits an MSP-owned connection, write
  // through the global client with the owner's tenantId so the visit never
  // creates default-owned rows that would collide with the MSP tenant's own
  // upserts on the [connectionId, node] unique key.
  const crossTenantView =
    tenantId === DEFAULT_TENANT_ID &&
    (conn.tenantId ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID
  const hostDb = crossTenantView ? globalPrisma : prisma
  const hostTenant: { tenantId?: string } = crossTenantView
    ? { tenantId: conn.tenantId }
    : {}

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
      let ipVerified = false
      let accurateMem: { used: number; total: number } | null = null
      let pveversion: string | null = null

      try {
        // Fetch network and node status in parallel for each node
        const [networks, nodeStatus] = await Promise.all([
          pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`).catch(() => null),
          node.status === 'online'
            ? pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/status`).catch(() => null)
            : Promise.resolve(null),
        ])

        const address = resolveManagementAddress(networks)
        ip = address?.ip ?? null
        ipVerified = address?.verified ?? false

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

        const rawPveVersion = nodeStatus?.pveversion as string | undefined
        if (rawPveVersion) {
          const parts = rawPveVersion.split('/')
          pveversion = parts.length >= 2 ? parts[1] : rawPveVersion
        }
      } catch {
        // Pas d'accès aux interfaces réseau ou au status
      }

      return {
        ...node,
        ...(accurateMem ? { mem: accurateMem.used, maxmem: accurateMem.total } : {}),
        ip,
        ipVerified,
        pveversion,
        hastate: hastateMap[nodeName] || null,
        bridges: (node as any)._bridges || null,
      }
    })
  )

  // Persist node IPs in DB for failover after restart. A guess from a
  // privilege-filtered interface list never replaces a stored management
  // address, and the response carries the address on file (roadmap#51).
  try {
    const persisted = await persistNodeIps(hostDb, {
      connectionId: id,
      ...hostTenant,
      nodes: enrichedNodes
        .map((n: any) => ({ node: n.node || n.name, ip: n.ip ?? null, verified: !!n.ipVerified }))
        .filter((n: any) => !!n.node),
    })
    for (const n of enrichedNodes as any[]) {
      const effective = persisted.byNode.get(n.node || n.name)
      if (effective) {
        n.ip = effective.ip
        n.ipVerified = effective.ipVerified
      }
    }
  } catch {
    // Non-blocking — don't break the API response
  }

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

  // Populate the node IP cache for failover, verified addresses first
  const nodeIps = orderedIps(
    enrichedNodes.map((n: any) => ({
      node: n.node || n.name,
      ip: typeof n.ip === "string" && n.ip.length > 0 ? n.ip : null,
      ipVerified: !!n.ipVerified,
    }))
  )

  if (nodeIps.length > 0) {
    try {
      const port = extractPortFromUrl(conn.baseUrl)
      const protocol = new URL(conn.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(id, nodeIps, port, protocol)
    } catch {
      // Invalid baseUrl — skip cache population
    }
  }

  // Fetch SSH address overrides from ManagedHost
  let sshOverrides: Record<string, { sshAddress: string | null; sshPort: number | null; hostId: string }> = {}
  try {
    const hosts = await hostDb.managedHost.findMany({
      where: { connectionId: id },
      select: { id: true, node: true, sshAddress: true, sshPort: true },
    })
    for (const h of hosts) {
      sshOverrides[h.node] = { sshAddress: h.sshAddress, sshPort: h.sshPort, hostId: h.id }
    }
  } catch {}

  let nodesWithSsh = enrichedNodes.map((n: any) => ({
    ...n,
    sshAddress: sshOverrides[n.node || n.name]?.sshAddress || null,
    sshPort: sshOverrides[n.node || n.name]?.sshPort ?? null,
    hostId: sshOverrides[n.node || n.name]?.hostId || null,
  }))

  // Node filtering: iaas (vDC) tenants see only their vDC's nodes; provider and
  // msp tenants see the full node list (msp owns the whole cluster). maskingScope
  // is null for provider + msp, so they skip filtering entirely.
  const mask = maskingScope(await getTenantInfrastructureScope(tenantId))
  if (mask) {
    const allowedNodes = mask.nodesByConnection.get(id)
    nodesWithSsh = allowedNodes
      ? nodesWithSsh.filter((n: any) => allowedNodes.has(n.node || n.name))
      : []
  }

  // Cache the response for 30s (keyed by tenant)
  cache.set(cacheKey, { data: nodesWithSsh, connectedNode, timestamp: Date.now() })

  return NextResponse.json({ data: nodesWithSsh, connectedNode })
}
