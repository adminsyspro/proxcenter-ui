import { NextRequest } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getRBACContext, filterVmsByPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import {
  getInventoryFromCache,
  setCachedInventory,
} from "@/lib/cache/inventoryCache"

export const runtime = "nodejs"

/**
 * GET /api/v1/inventory/stream
 *
 * SSE endpoint that streams inventory data progressively.
 * Each cluster/PBS is sent as an event as soon as it's ready,
 * so the frontend can render incrementally without waiting for
 * the slowest connection.
 *
 * Events:
 *   - event: init         → { totalPve, totalPbs, totalExt }  (how many items to expect)
 *   - event: cluster      → ClusterData  (one per PVE connection, as it resolves)
 *   - event: pbs          → PbsServerData  (one per PBS connection)
 *   - event: external     → ExternalHypervisor[]  (all external hypervisors at once)
 *   - event: done         → { stats }  (final summary)
 *   - event: error        → { message }
 *
 * Query params:
 *   ?refresh=true  — bypass cache
 */

type NodeData = {
  node: string
  status: string
  cpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  ip?: string
  maintenance?: string
}

type GuestData = {
  vmid: string | number
  name?: string
  type: string
  status: string
  node: string
  cpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  pool?: string
  tags?: string
  template?: number | boolean
  hastate?: string
  hagroup?: string
}

type HaResource = {
  sid: string
  state: string
  group?: string
}

type ClusterData = {
  id: string
  name: string
  type: string
  isCluster: boolean
  status: 'online' | 'degraded' | 'offline'
  cephHealth?: string
  latitude?: number | null
  longitude?: number | null
  locationLabel?: string | null
  sshEnabled?: boolean
  nodes: Array<NodeData & { guests: GuestData[] }>
}

type PbsDatastoreData = {
  name: string
  path?: string
  comment?: string
  total: number
  used: number
  available: number
  usagePercent: number
  backupCount: number
  vmCount: number
  ctCount: number
  hostCount: number
}

type PbsServerData = {
  id: string
  name: string
  type: 'pbs'
  status: 'online' | 'offline'
  version?: string
  uptime?: number
  datastores: PbsDatastoreData[]
  stats: {
    totalSize: number
    totalUsed: number
    datastoreCount: number
    backupCount: number
  }
}

/* ------------------------------------------------------------------ */
/* Per-connection fetch functions (reused from inventory route)         */
/* ------------------------------------------------------------------ */

async function fetchOneCluster(conn: {
  id: string; name: string; type: string;
  latitude?: number | null; longitude?: number | null;
  locationLabel?: string | null; sshEnabled?: boolean | null
}): Promise<ClusterData> {
  try {
    const connConfig = await getConnectionById(conn.id)

    const [nodesResult, guestsResult, haResult, cephResult, nodeResourcesResult] = await Promise.allSettled([
      pveFetch<NodeData[]>(connConfig, '/nodes'),
      pveFetch<GuestData[]>(connConfig, '/cluster/resources?type=vm'),
      pveFetch<HaResource[]>(connConfig, '/cluster/ha/resources'),
      pveFetch<any>(connConfig, '/cluster/ceph/status'),
      pveFetch<any[]>(connConfig, '/cluster/resources?type=node'),
    ])

    const nodes: NodeData[] = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
    const guests: GuestData[] = guestsResult.status === 'fulfilled' ? guestsResult.value || [] : []
    const haResources: HaResource[] = haResult.status === 'fulfilled' ? haResult.value || [] : []
    const nodeResources: any[] = nodeResourcesResult.status === 'fulfilled' ? nodeResourcesResult.value || [] : []

    const nodeHastateMap = new Map<string, string>()
    for (const nr of nodeResources) {
      if (nr?.node && nr?.hastate) nodeHastateMap.set(nr.node, nr.hastate)
    }

    let cephHealth: string | undefined
    if (cephResult.status === 'fulfilled' && cephResult.value) {
      const cephData = cephResult.value
      if (typeof cephData.health === 'string') {
        cephHealth = cephData.health
      } else if (cephData.health?.status) {
        cephHealth = cephData.health.status
      }
    }

    const nodeEnrichPromises = nodes.map(async (node) => {
      if (!node?.node) return { node: node.node, ip: undefined, mem: undefined, maxmem: undefined }

      try {
        const [networks, nodeStatus] = await Promise.all([
          pveFetch<any[]>(connConfig, `/nodes/${encodeURIComponent(node.node)}/network`).catch(() => null),
          node.status === 'online'
            ? pveFetch<any>(connConfig, `/nodes/${encodeURIComponent(node.node)}/status`).catch(() => null)
            : Promise.resolve(null),
        ])

        return {
          node: node.node,
          ip: resolveManagementIp(networks),
          mem: nodeStatus?.memory?.total > 0 ? Number(nodeStatus.memory.used || 0) : undefined,
          maxmem: nodeStatus?.memory?.total > 0 ? Number(nodeStatus.memory.total || 0) : undefined,
        }
      } catch {
        return { node: node.node, ip: undefined, mem: undefined, maxmem: undefined }
      }
    })

    const nodeEnrichData = await Promise.all(nodeEnrichPromises)
    const nodeIpMap = new Map<string, { ip?: string; mem?: number; maxmem?: number }>()
    for (const { node, ip, mem, maxmem } of nodeEnrichData) {
      if (node) nodeIpMap.set(node, { ip, mem, maxmem })
    }

    const haMap = new Map<string, HaResource>()
    for (const ha of haResources) {
      if (ha.sid) haMap.set(ha.sid, ha)
    }

    const nodeMap = new Map<string, NodeData & { guests: GuestData[] }>()
    for (const n of nodes) {
      if (!n?.node) continue
      const extra = nodeIpMap.get(n.node)
      const hastate = nodeHastateMap.get(n.node)
      const maintenance = hastate === 'maintenance' ? 'maintenance' : undefined
      nodeMap.set(n.node, {
        ...n,
        ...(extra?.mem !== undefined ? { mem: extra.mem } : {}),
        ...(extra?.maxmem !== undefined ? { maxmem: extra.maxmem } : {}),
        ip: extra?.ip,
        maintenance,
        guests: []
      })
    }

    for (const g of guests) {
      if (!g?.node) continue
      if (!nodeMap.has(g.node)) {
        nodeMap.set(g.node, { node: g.node, status: 'unknown', guests: [] })
      }
      nodeMap.get(g.node)!.guests.push({
        vmid: g.vmid,
        name: g.name || `${g.type}/${g.vmid}`,
        type: g.type || 'qemu',
        status: g.status || 'unknown',
        node: g.node,
        cpu: g.cpu, mem: g.mem, maxmem: g.maxmem,
        disk: g.disk, maxdisk: g.maxdisk,
        uptime: g.uptime, pool: g.pool, tags: g.tags,
        template: g.template === 1 || g.template === true,
        hastate: (() => {
          const haSid = `${g.type === 'lxc' ? 'ct' : 'vm'}:${g.vmid}`
          return haMap.get(haSid)?.state
        })(),
        hagroup: (() => {
          const haSid = `${g.type === 'lxc' ? 'ct' : 'vm'}:${g.vmid}`
          return haMap.get(haSid)?.group
        })(),
      })
    }

    for (const nodeData of nodeMap.values()) {
      nodeData.guests.sort((a, b) => {
        const aId = parseInt(String(a.vmid), 10) || 0
        const bId = parseInt(String(b.vmid), 10) || 0
        return aId - bId
      })
    }

    const nodesArray = Array.from(nodeMap.values())
    const onlineNodes = nodesArray.filter(n => n.status === 'online').length
    const totalNodes = nodesArray.length

    let status: 'online' | 'degraded' | 'offline' = 'offline'
    if (onlineNodes === totalNodes && totalNodes > 0) status = 'online'
    else if (onlineNodes > 0) status = 'degraded'

    return {
      id: conn.id,
      name: conn.name,
      type: conn.type,
      isCluster: totalNodes > 1,
      status,
      cephHealth,
      sshEnabled: !!conn.sshEnabled,
      latitude: conn.latitude,
      longitude: conn.longitude,
      locationLabel: conn.locationLabel,
      nodes: nodesArray.sort((a, b) => a.node.localeCompare(b.node)),
    }
  } catch (e: any) {
    console.error(`[inventory-stream] Failed to load ${conn.name}:`, e?.message)
    return {
      id: conn.id,
      name: conn.name,
      type: conn.type,
      isCluster: false,
      status: 'offline' as const,
      sshEnabled: !!conn.sshEnabled,
      latitude: conn.latitude,
      longitude: conn.longitude,
      locationLabel: conn.locationLabel,
      nodes: [],
    }
  }
}

async function fetchOnePbs(conn: { id: string; name: string }): Promise<PbsServerData> {
  try {
    const connConfig = await getPbsConnectionById(conn.id)

    const [statusResult, datastoresResult] = await Promise.allSettled([
      pbsFetch<any>(connConfig, '/status'),
      pbsFetch<any[]>(connConfig, '/admin/datastore'),
    ])

    const status = statusResult.status === 'fulfilled' ? statusResult.value : null
    const datastores = datastoresResult.status === 'fulfilled' ? datastoresResult.value || [] : []

    const datastoreDetailsPromises = datastores.map(async (ds): Promise<PbsDatastoreData> => {
      const storeName = ds.store || ds.name
      if (!storeName) {
        return { name: 'unknown', total: 0, used: 0, available: 0, usagePercent: 0, backupCount: 0, vmCount: 0, ctCount: 0, hostCount: 0 }
      }

      try {
        const [dsStatusResult, snapshotsResult] = await Promise.allSettled([
          pbsFetch<any>(connConfig, `/admin/datastore/${encodeURIComponent(storeName)}/status`),
          pbsFetch<any[]>(connConfig, `/admin/datastore/${encodeURIComponent(storeName)}/snapshots`),
        ])

        const dsStatus = dsStatusResult.status === 'fulfilled' ? dsStatusResult.value : null
        const snapshots = snapshotsResult.status === 'fulfilled' ? snapshotsResult.value || [] : []

        const total = dsStatus?.total || 0
        const used = dsStatus?.used || 0
        const available = dsStatus?.avail || (total - used)

        let vmCount = 0, ctCount = 0, hostCount = 0
        for (const snap of snapshots) {
          const backupType = snap['backup-type']
          if (backupType === 'vm') vmCount++
          else if (backupType === 'ct') ctCount++
          else if (backupType === 'host') hostCount++
        }

        return {
          name: storeName, path: ds.path || '', comment: ds.comment || '',
          total, used, available,
          usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
          backupCount: snapshots.length, vmCount, ctCount, hostCount,
        }
      } catch {
        return {
          name: storeName, path: ds.path || '', comment: ds.comment || '',
          total: 0, used: 0, available: 0, usagePercent: 0,
          backupCount: 0, vmCount: 0, ctCount: 0, hostCount: 0,
        }
      }
    })

    const datastoreDetails = await Promise.all(datastoreDetailsPromises)
    let totalSize = 0, totalUsed = 0, totalBackups = 0
    for (const ds of datastoreDetails) {
      totalSize += ds.total; totalUsed += ds.used; totalBackups += ds.backupCount
    }

    return {
      id: conn.id,
      name: conn.name,
      type: 'pbs',
      status: status ? 'online' : 'offline',
      version: status?.info?.version || undefined,
      uptime: status?.uptime || undefined,
      datastores: datastoreDetails,
      stats: { totalSize, totalUsed, datastoreCount: datastoreDetails.length, backupCount: totalBackups }
    }
  } catch (e: any) {
    console.error(`[inventory-stream] Failed to load PBS ${conn.name}:`, e?.message)
    return {
      id: conn.id,
      name: conn.name,
      type: 'pbs',
      status: 'offline',
      datastores: [],
      stats: { totalSize: 0, totalUsed: 0, datastoreCount: 0, backupCount: 0 }
    }
  }
}

/* ------------------------------------------------------------------ */
/* RBAC filtering for a single cluster                                 */
/* ------------------------------------------------------------------ */

function applyRbacToCluster(cluster: ClusterData, rbacCtx: any): ClusterData {
  if (!rbacCtx || rbacCtx.isAdmin) return cluster
  return {
    ...cluster,
    nodes: cluster.nodes.map(node => ({
      ...node,
      guests: filterVmsByPermission(
        rbacCtx.userId,
        node.guests.map(g => ({
          ...g,
          connId: cluster.id,
          node: node.node,
          vmid: String(g.vmid),
        })),
        PERMISSIONS.VM_VIEW
      )
    }))
  }
}

/* ------------------------------------------------------------------ */
/* GET handler — SSE stream                                            */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  // Check cache first — if fresh, send everything at once (fast path)
  const cacheResult = forceRefresh ? { status: 'miss' as const } : getInventoryFromCache()

  const encoder = new TextEncoder()

  if (cacheResult.status === 'fresh' || cacheResult.status === 'stale') {
    // Serve cached data as a quick burst of events
    const cached = cacheResult.data
    const rbacCtx = await getRBACContext()

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        send('init', {
          totalPve: cached.clusters.length,
          totalPbs: cached.pbsServers.length,
          totalExt: cached.externalHypervisors.length,
          cached: true,
        })

        for (const cluster of cached.clusters) {
          send('cluster', applyRbacToCluster(cluster, rbacCtx))
        }
        for (const pbs of cached.pbsServers) {
          send('pbs', pbs)
        }
        if (cached.externalHypervisors.length > 0) {
          send('external', cached.externalHypervisors)
        }
        send('done', { stats: cached.stats })
        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // Cache miss — stream progressively as each connection resolves
  const rbacCtx = await getRBACContext()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Client disconnected
        }
      }

      try {
        const startTime = Date.now()

        // Load all connections from DB
        const [pveConnections, pbsConnections, externalConnections] = await Promise.all([
          prisma.connection.findMany({
            where: { type: 'pve' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, type: true, latitude: true, longitude: true, locationLabel: true, sshEnabled: true },
          }),
          prisma.connection.findMany({
            where: { type: 'pbs' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, type: true },
          }),
          prisma.connection.findMany({
            where: { type: { in: ['vmware', 'hyperv', 'xcpng'] } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, type: true },
          }),
        ])

        // Send init event so frontend knows how many items to expect
        send('init', {
          totalPve: pveConnections.length,
          totalPbs: pbsConnections.length,
          totalExt: externalConnections.length,
          cached: false,
        })

        // Send external hypervisors immediately (no fetch needed)
        if (externalConnections.length > 0) {
          send('external', externalConnections)
        }

        // Fire all fetches concurrently — each sends its event as soon as ready
        const allClusters: ClusterData[] = []
        const allPbsServers: PbsServerData[] = []

        const clusterPromises = pveConnections.map(async (conn) => {
          const cluster = await fetchOneCluster(conn)
          allClusters.push(cluster)
          send('cluster', applyRbacToCluster(cluster, rbacCtx))
        })

        const pbsPromises = pbsConnections.map(async (conn) => {
          const pbs = await fetchOnePbs(conn)
          allPbsServers.push(pbs)
          send('pbs', pbs)
        })

        // Wait for all to complete (each already sent its event)
        await Promise.allSettled([...clusterPromises, ...pbsPromises])

        // Compute stats
        let totalNodes = 0, onlineNodes = 0, totalGuests = 0, runningGuests = 0
        for (const cluster of allClusters) {
          for (const node of cluster.nodes) {
            totalNodes++
            if (node.status === 'online') onlineNodes++
            for (const guest of node.guests) {
              totalGuests++
              if (guest.status === 'running') runningGuests++
            }
          }
        }

        let totalDatastores = 0, totalBackups = 0
        for (const pbs of allPbsServers) {
          totalDatastores += pbs.stats.datastoreCount
          totalBackups += pbs.stats.backupCount
        }

        const stats = {
          totalClusters: allClusters.length,
          totalNodes, totalGuests, onlineNodes, runningGuests,
          totalPbsServers: allPbsServers.length,
          totalDatastores, totalBackups,
        }

        // Update the shared cache so the non-stream endpoint benefits too
        setCachedInventory({
          clusters: allClusters,
          pbsServers: allPbsServers,
          externalHypervisors: externalConnections,
          stats,
        })

        console.log(`[inventory-stream] Streamed all data in ${Date.now() - startTime}ms`)
        send('done', { stats })
      } catch (e: any) {
        console.error('[inventory-stream] Error:', e?.message)
        send('error', { message: e?.message || String(e) })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
