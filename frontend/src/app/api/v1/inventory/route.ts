import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getRBACContext, filterVmsByPermission, PERMISSIONS } from "@/lib/rbac"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import {
  getInventoryFromCache,
  setCachedInventory,
  getInflightFetch,
  setInflightFetch,
} from "@/lib/cache/inventoryCache"

export const runtime = "nodejs"

/**
 * GET /api/v1/inventory
 *
 * API agrégée qui retourne l'arbre complet de l'infrastructure en une seule requête.
 * Optimisé avec cache in-memory (TTL 30s) pour éviter de re-requêter Proxmox à chaque appel.
 * Le RBAC est appliqué APRÈS le cache — chaque user reçoit sa vue filtrée.
 *
 * Query params:
 *   ?refresh=true  — force le bypass du cache (bouton refresh manuel, post-action)
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
  max_restart?: number
  max_relocate?: number
}

type ClusterData = {
  id: string
  name: string
  type: string
  isCluster: boolean
  status: 'online' | 'degraded' | 'offline'
  cephHealth?: string
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
/* Raw fetch from Proxmox (the expensive part)                        */
/* ------------------------------------------------------------------ */

async function fetchRawInventory(): Promise<{
  clusters: ClusterData[]
  pbsServers: PbsServerData[]
  stats: { totalClusters: number; totalNodes: number; totalGuests: number; onlineNodes: number; runningGuests: number; totalPbsServers: number; totalDatastores: number; totalBackups: number }
}> {
  // 1) Charger toutes les connexions PVE et PBS en parallèle
  const [pveConnections, pbsConnections] = await Promise.all([
    prisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true },
    }),
    prisma.connection.findMany({
      where: { type: 'pbs' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true },
    }),
  ])

  const emptyResult = {
    clusters: [] as ClusterData[],
    pbsServers: [] as PbsServerData[],
    stats: {
      totalClusters: 0, totalNodes: 0, totalGuests: 0,
      onlineNodes: 0, runningGuests: 0,
      totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
    }
  }

  if (!pveConnections.length && !pbsConnections.length) {
    return emptyResult
  }

  // 2) Pour chaque connexion PVE, charger nodes et guests EN PARALLÈLE
  const clusterPromises = pveConnections.map(async (conn): Promise<ClusterData | null> => {
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

      const nodeIpPromises = nodes.map(async (node) => {
        if (!node?.node) return { node: node.node, ip: undefined }

        try {
          const networks = await pveFetch<any[]>(
            connConfig,
            `/nodes/${encodeURIComponent(node.node)}/network`
          ).catch(() => null)

          return { node: node.node, ip: resolveManagementIp(networks) }
        } catch {
          return { node: node.node, ip: undefined }
        }
      })

      const nodeIps = await Promise.all(nodeIpPromises)
      const nodeIpMap = new Map<string, { ip?: string }>()

      for (const { node, ip } of nodeIps) {
        if (node) nodeIpMap.set(node, { ip })
      }

      const haMap = new Map<string, HaResource>()

      for (const ha of haResources) {
        if (ha.sid) {
          haMap.set(ha.sid, ha)
        }
      }

      const nodeMap = new Map<string, NodeData & { guests: GuestData[] }>()

      for (const n of nodes) {
        if (!n?.node) continue
        const extra = nodeIpMap.get(n.node)
        const hastate = nodeHastateMap.get(n.node)
        const maintenance = hastate === 'maintenance' ? 'maintenance' : undefined
        nodeMap.set(n.node, {
          ...n,
          ip: extra?.ip,
          maintenance,
          guests: []
        })
      }

      for (const g of guests) {
        if (!g?.node) continue

        if (!nodeMap.has(g.node)) {
          nodeMap.set(g.node, {
            node: g.node,
            status: 'unknown',
            guests: []
          })
        }

        nodeMap.get(g.node)!.guests.push({
          vmid: g.vmid,
          name: g.name || `${g.type}/${g.vmid}`,
          type: g.type || 'qemu',
          status: g.status || 'unknown',
          node: g.node,
          cpu: g.cpu,
          mem: g.mem,
          maxmem: g.maxmem,
          disk: g.disk,
          maxdisk: g.maxdisk,
          uptime: g.uptime,
          pool: g.pool,
          tags: g.tags,
          template: g.template === 1 || g.template === true,
          hastate: (() => {
            const haSid = `${g.type === 'lxc' ? 'ct' : 'vm'}:${g.vmid}`
            const ha = haMap.get(haSid)


return ha?.state
          })(),
          hagroup: (() => {
            const haSid = `${g.type === 'lxc' ? 'ct' : 'vm'}:${g.vmid}`
            const ha = haMap.get(haSid)


return ha?.group
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

      if (onlineNodes === totalNodes && totalNodes > 0) {
        status = 'online'
      } else if (onlineNodes > 0) {
        status = 'degraded'
      }

      return {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        isCluster: totalNodes > 1,
        status,
        cephHealth,
        nodes: nodesArray.sort((a, b) => a.node.localeCompare(b.node)),
      }
    } catch (e: any) {
      console.error(`[inventory] Failed to load ${conn.name}:`, e?.message)

      return {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        isCluster: false,
        status: 'offline' as const,
        nodes: [],
      }
    }
  })

  const clustersResults = await Promise.all(clusterPromises)
  const clusters = clustersResults.filter((c): c is ClusterData => c !== null)

  // 3) Pour chaque connexion PBS, charger status et datastores EN PARALLÈLE
  const pbsPromises = pbsConnections.map(async (conn): Promise<PbsServerData | null> => {
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
          return {
            name: 'unknown',
            total: 0, used: 0, available: 0, usagePercent: 0,
            backupCount: 0, vmCount: 0, ctCount: 0, hostCount: 0,
          }
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

          let vmCount = 0
          let ctCount = 0
          let hostCount = 0

          for (const snap of snapshots) {
            const backupType = snap['backup-type']
            if (backupType === 'vm') vmCount++
            else if (backupType === 'ct') ctCount++
            else if (backupType === 'host') hostCount++
          }

          return {
            name: storeName,
            path: ds.path || '',
            comment: ds.comment || '',
            total, used, available,
            usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
            backupCount: snapshots.length,
            vmCount, ctCount, hostCount,
          }
        } catch {
          return {
            name: storeName,
            path: ds.path || '',
            comment: ds.comment || '',
            total: 0, used: 0, available: 0, usagePercent: 0,
            backupCount: 0, vmCount: 0, ctCount: 0, hostCount: 0,
          }
        }
      })

      const datastoreDetails = await Promise.all(datastoreDetailsPromises)

      let totalSize = 0
      let totalUsed = 0
      let totalBackups = 0

      for (const ds of datastoreDetails) {
        totalSize += ds.total
        totalUsed += ds.used
        totalBackups += ds.backupCount
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
      console.error(`[inventory] Failed to load PBS ${conn.name}:`, e?.message)
      return {
        id: conn.id,
        name: conn.name,
        type: 'pbs',
        status: 'offline',
        datastores: [],
        stats: { totalSize: 0, totalUsed: 0, datastoreCount: 0, backupCount: 0 }
      }
    }
  })

  const pbsResults = await Promise.all(pbsPromises)
  const pbsServers = pbsResults.filter((p): p is PbsServerData => p !== null)

  // 4) Calculer les stats globales (sur données brutes, avant RBAC)
  let totalNodes = 0
  let onlineNodes = 0
  let totalGuests = 0
  let runningGuests = 0

  for (const cluster of clusters) {
    for (const node of cluster.nodes) {
      totalNodes++
      if (node.status === 'online') onlineNodes++

      for (const guest of node.guests) {
        totalGuests++
        if (guest.status === 'running') runningGuests++
      }
    }
  }

  let totalDatastores = 0
  let totalBackups = 0

  for (const pbs of pbsServers) {
    totalDatastores += pbs.stats.datastoreCount
    totalBackups += pbs.stats.backupCount
  }

  return {
    clusters,
    pbsServers,
    stats: {
      totalClusters: clusters.length,
      totalNodes,
      totalGuests,
      onlineNodes,
      runningGuests,
      totalPbsServers: pbsServers.length,
      totalDatastores,
      totalBackups,
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fetch helpers (blocking + background revalidation)                  */
/* ------------------------------------------------------------------ */

/**
 * Blocking fetch with thundering-herd protection.
 * Used on cache miss or force refresh — the caller awaits the result.
 */
async function blockingFetch() {
  let inflight = getInflightFetch()

  if (!inflight) {
    const startTime = Date.now()
    inflight = fetchRawInventory()
      .then(result => {
        console.log(`[inventory] Fetched from Proxmox in ${Date.now() - startTime}ms`)
        setCachedInventory(result)
        setInflightFetch(null)
        return result
      })
      .catch(err => {
        setInflightFetch(null)
        throw err
      })
    setInflightFetch(inflight)
  } else {
    console.log('[inventory] Reusing in-flight fetch')
  }

  return inflight
}

/**
 * Trigger a background revalidation if one isn't already in progress.
 * Fire-and-forget — errors are logged but don't affect the current request.
 */
function triggerBackgroundRevalidation() {
  if (getInflightFetch()) {
    console.log('[inventory] Background revalidation already in progress, skipping')
    return
  }

  const startTime = Date.now()
  const revalidation = fetchRawInventory()
    .then(result => {
      console.log(`[inventory] Background revalidation completed in ${Date.now() - startTime}ms`)
      setCachedInventory(result)
      setInflightFetch(null)
    })
    .catch(err => {
      console.error('[inventory] Background revalidation failed:', err?.message)
      setInflightFetch(null)
    })
  setInflightFetch(revalidation as any)
}

/* ------------------------------------------------------------------ */
/* GET handler                                                        */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

    // 1) Tenter le cache (sauf si refresh forcé)
    const cacheResult = forceRefresh ? { status: 'miss' as const } : getInventoryFromCache()

    let raw: Awaited<ReturnType<typeof fetchRawInventory>>

    if (cacheResult.status === 'fresh') {
      // Cache is fresh — serve directly, no fetch needed
      console.log('[inventory] Serving from cache (fresh)')
      raw = cacheResult.data
    } else if (cacheResult.status === 'stale') {
      // Cache is stale — serve immediately, trigger background revalidation
      console.log('[inventory] Serving stale data, revalidating in background')
      raw = cacheResult.data
      triggerBackgroundRevalidation()
    } else {
      // Cache miss or force refresh — blocking fetch required
      raw = await blockingFetch()
    }

    // 2) Deep-clone clusters pour le filtrage RBAC (ne pas muter le cache)
    let clusters: ClusterData[] = raw.clusters.map(c => ({
      ...c,
      nodes: c.nodes.map(n => ({
        ...n,
        guests: [...n.guests]
      }))
    }))

    // 3) RBAC: Filtrer les guests selon les permissions de l'utilisateur
    const rbacCtx = await getRBACContext()

    if (rbacCtx && !rbacCtx.isAdmin) {
      clusters = clusters.map(cluster => ({
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
      }))
    }

    // 4) Recalculer les stats après filtrage RBAC
    let totalNodes = 0
    let onlineNodes = 0
    let totalGuests = 0
    let runningGuests = 0

    for (const cluster of clusters) {
      for (const node of cluster.nodes) {
        totalNodes++
        if (node.status === 'online') onlineNodes++

        for (const guest of node.guests) {
          totalGuests++
          if (guest.status === 'running') runningGuests++
        }
      }
    }

    let totalDatastores = 0
    let totalBackups = 0

    for (const pbs of raw.pbsServers) {
      totalDatastores += pbs.stats.datastoreCount
      totalBackups += pbs.stats.backupCount
    }

    return NextResponse.json({
      data: {
        clusters,
        pbsServers: raw.pbsServers,
        cached: cacheResult.status !== 'miss',
        stats: {
          totalClusters: clusters.length,
          totalNodes,
          totalGuests,
          onlineNodes,
          runningGuests,
          totalPbsServers: raw.pbsServers.length,
          totalDatastores,
          totalBackups,
        }
      }
    })
  } catch (e: any) {
    console.error('[inventory] Error:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
