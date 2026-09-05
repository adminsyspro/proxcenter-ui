// Extracted from src/app/api/v1/inventory/route.ts (spec D9): the raw
// multi-cluster fan-out plus its stale-while-revalidate cache wrapper, so the
// public metrics/health endpoints reuse ONE implementation instead of copying
// it (Sonar new-code duplication ceiling is 3%).
//
// The fan-out reads /nodes FIRST and skips offline nodes: on a 3-node cluster
// with one node down, every per-guest call to the dead node fails with HTTP 595
// after about 1s, so 50 guests on a dead node would add 50s of latency
// (measured, spec section 9).
import { getSessionPrisma } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { collectNodeAddresses, resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import {
  getInventoryFromCache,
  setCachedInventory,
  getInflightFetch,
  setInflightFetch,
} from "@/lib/cache/inventoryCache"
import { inventoryConnectionPlan, type InfraScope } from "@/lib/tenant/infraScope"

export type NodeData = {
  node: string
  status: string
  cpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  ip?: string
  /** All non-loopback addresses of the host, for the IP search of the palette (#861). */
  ips?: string[]
  maintenance?: string
}

export type GuestData = {
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

export type HaResource = {
  sid: string
  state: string
  group?: string
  max_restart?: number
  max_relocate?: number
}

export type ClusterData = {
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

export type PbsDatastoreData = {
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

export type PbsServerData = {
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

export type ExternalHypervisor = {
  id: string
  name: string
  type: string
}

export type RawInventory = {
  clusters: ClusterData[]
  pbsServers: PbsServerData[]
  externalHypervisors: ExternalHypervisor[]
  storages: any[]
  stats: { totalClusters: number; totalNodes: number; totalGuests: number; onlineNodes: number; runningGuests: number; totalPbsServers: number; totalDatastores: number; totalBackups: number }
}

export async function fetchRawInventory(infra: InfraScope): Promise<RawInventory> {
  const sessionPrisma = await getSessionPrisma()
  const plan = inventoryConnectionPlan(infra)
  const pveClient = plan.pveClient === 'global' ? globalPrisma : sessionPrisma
  const pbsExtClient = plan.pbsExtClient === 'global' ? globalPrisma : sessionPrisma
  const pveWhere = plan.pveConnectionIds
    ? { type: 'pve' as const, id: { in: plan.pveConnectionIds } }
    : { type: 'pve' as const }

  const [pveConnections, pbsConnections, externalConnections] = await Promise.all([
    pveClient.connection.findMany({
      where: pveWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true, latitude: true, longitude: true, locationLabel: true, sshEnabled: true, tenantId: true },
    }),
    pbsExtClient.connection.findMany({
      where: { type: 'pbs' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true, tenantId: true },
    }),
    pbsExtClient.connection.findMany({
      where: { type: { in: ['vmware', 'hyperv', 'xcpng', 'nutanix'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true },
    }),
  ])

  const emptyResult = {
    clusters: [] as ClusterData[],
    pbsServers: [] as PbsServerData[],
    externalHypervisors: [] as ExternalHypervisor[],
    storages: [] as any[],
    stats: {
      totalClusters: 0, totalNodes: 0, totalGuests: 0,
      onlineNodes: 0, runningGuests: 0,
      totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
    }
  }

  if (!pveConnections.length && !pbsConnections.length && !externalConnections.length) {
    return { ...emptyResult, externalHypervisors: externalConnections }
  }

  // 2) Pour chaque connexion PVE, charger nodes et guests EN PARALLÈLE
  const clusterPromises = pveConnections.map(async (conn): Promise<ClusterData | null> => {
    try {
      const connConfig = await getConnectionById(conn.id, (conn as any).tenantId)

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
        if (!node?.node) return { node: node.node, ip: undefined, ips: [] as string[], mem: undefined, maxmem: undefined }

        try {
          // Fetch network and node status in parallel
          const [networks, nodeStatus] = await Promise.all([
            pveFetch<any[]>(connConfig, `/nodes/${encodeURIComponent(node.node)}/network`).catch(() => null),
            node.status === 'online'
              ? pveFetch<any>(connConfig, `/nodes/${encodeURIComponent(node.node)}/status`).catch(() => null)
              : Promise.resolve(null),
          ])

          return {
            node: node.node,
            ip: resolveManagementIp(networks),
            ips: collectNodeAddresses(networks),
            // Use memory from /nodes/{node}/status (excludes ZFS ARC / kernel caches)
            mem: nodeStatus?.memory?.total > 0 ? Number(nodeStatus.memory.used || 0) : undefined,
            maxmem: nodeStatus?.memory?.total > 0 ? Number(nodeStatus.memory.total || 0) : undefined,
          }
        } catch {
          return { node: node.node, ip: undefined, ips: [] as string[], mem: undefined, maxmem: undefined }
        }
      })

      const nodeEnrichData = await Promise.all(nodeEnrichPromises)
      const nodeIpMap = new Map<string, { ip?: string; ips: string[]; mem?: number; maxmem?: number }>()

      for (const { node, ip, ips, mem, maxmem } of nodeEnrichData) {
        if (node) nodeIpMap.set(node, { ip, ips, mem, maxmem })
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
          // Override mem/maxmem with accurate values from /nodes/{node}/status
          ...(extra?.mem !== undefined ? { mem: extra.mem } : {}),
          ...(extra?.maxmem !== undefined ? { maxmem: extra.maxmem } : {}),
          ip: extra?.ip,
          ips: extra?.ips ?? [],
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
          const aId = Number.parseInt(String(a.vmid), 10) || 0
          const bId = Number.parseInt(String(b.vmid), 10) || 0


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
        sshEnabled: !!conn.sshEnabled,
        latitude: conn.latitude,
        longitude: conn.longitude,
        locationLabel: conn.locationLabel,
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
        sshEnabled: !!conn.sshEnabled,
        latitude: conn.latitude,
        longitude: conn.longitude,
        locationLabel: conn.locationLabel,
        nodes: [],
      }
    }
  })

  const clustersResults = await Promise.all(clusterPromises)
  const clusters = clustersResults.filter((c): c is ClusterData => c !== null)

  // 3) Pour chaque connexion PBS, charger status et datastores EN PARALLÈLE
  const pbsPromises = pbsConnections.map(async (conn): Promise<PbsServerData | null> => {
    try {
      // Pass the connection's own tenantId so the provider (global query) can
      // open PBS servers owned by MSP tenants, not just default-owned ones.
      const connConfig = await getPbsConnectionById(conn.id, (conn as any).tenantId)

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
    externalHypervisors: externalConnections,
    storages: [],
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
 *
 * `vdcContext` MUST describe the same scope `infra` was resolved under — a
 * narrowed `infra` stored under the union cache key (or vice-versa) poisons
 * the cache: the next reader for the wrong context gets someone else's slice
 * of the inventory (or a truncated one).
 */
export async function blockingFetch(tenantId: string, infra: InfraScope, vdcContext: string | null = null) {
  let inflight = getInflightFetch(tenantId, vdcContext)

  if (inflight === null) {
    const startTime = Date.now()
    inflight = fetchRawInventory(infra)
      .then(result => {
        console.log(`[inventory] Fetched from Proxmox in ${Date.now() - startTime}ms`)
        setCachedInventory(result, tenantId, vdcContext)
        setInflightFetch(null, tenantId, vdcContext)
        return result
      })
      .catch(err => {
        setInflightFetch(null, tenantId, vdcContext)
        throw err
      })
    setInflightFetch(inflight, tenantId, vdcContext)
  }

  return inflight
}

/**
 * Trigger a background revalidation if one isn't already in progress.
 * Fire-and-forget — errors are logged but don't affect the current request.
 *
 * `vdcContext` MUST describe the same scope `infra` was resolved under — a
 * narrowed `infra` stored under the union cache key (or vice-versa) poisons
 * the cache: the next reader for the wrong context gets someone else's slice
 * of the inventory (or a truncated one).
 */
export function triggerBackgroundRevalidation(tenantId: string, infra: InfraScope, vdcContext: string | null = null) {
  if (getInflightFetch(tenantId, vdcContext) !== null) return

  const startTime = Date.now()

  // This promise goes into the SHARED in-flight slot, which blockingFetch
  // hands straight back to its callers. So it must resolve to the inventory
  // and reject on failure, exactly like blockingFetch's own promise does.
  //
  // It used to do neither. The `.then` returned nothing and the `.catch`
  // swallowed the error, making this a Promise<void> stored through an
  // `as any` — the slot is typed Promise<CachedInventory>, so the cast was
  // the only reason it compiled. Any request that reached the blocking path
  // while a background revalidation was running got that promise, awaited it,
  // and received `undefined`, which then died on `raw.clusters` as a 500.
  // Reproduced on the first inventory call after a server start, but the same
  // window opens on EVERY stale revalidation, so under a polling monitor it
  // was an intermittent 500 with no explanation.
  const revalidation = fetchRawInventory(infra)
    .then(result => {
      console.log(`[inventory] Background revalidation completed in ${Date.now() - startTime}ms`)
      setCachedInventory(result, tenantId, vdcContext)
      setInflightFetch(null, tenantId, vdcContext)

      return result
    })
    .catch(err => {
      console.error('[inventory] Background revalidation failed:', err?.message)
      setInflightFetch(null, tenantId, vdcContext)
      // Rethrow so a piggybacking blockingFetch caller learns the fetch
      // failed. Answering it with `undefined` is what produced the bogus
      // TypeError instead of the real cause.
      throw err
    })

  setInflightFetch(revalidation, tenantId, vdcContext)

  // Fire-and-forget for THIS caller: the rethrow above is for whoever awaits
  // the shared slot, and without a detached handler it would surface as an
  // unhandled rejection. Attached after the slot is set, and deliberately on
  // a separate handler chain so the promise stored above still rejects.
  revalidation.catch(() => {})
}

/** All-empty shape, same fields as a real RawInventory, served on a cold
 * cache to a `nonBlocking` caller instead of making it wait. */
function emptyRawInventory(): RawInventory {
  return {
    clusters: [],
    pbsServers: [],
    externalHypervisors: [],
    storages: [],
    stats: {
      totalClusters: 0, totalNodes: 0, totalGuests: 0, onlineNodes: 0,
      runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
    },
  }
}

/**
 * Stale-while-revalidate read, extracted from route.ts:586-601 so the public
 * endpoints share it. Fresh: serve. Stale: serve and revalidate in the
 * background. Miss or forceRefresh: blocking fetch — UNLESS `nonBlocking`.
 *
 * `nonBlocking` exists for the public scrape endpoints ONLY (D12): a UI
 * caller awaiting a cold cache is normal and bounded by the user's
 * patience, but a Prometheus scrape has a fixed ~10s default timeout and a
 * cold fan-out over a large fleet can take longer than that (measured ~5s
 * for 500 VMs, worse for bigger fleets or PBS) — the scrape would time out
 * and get marked DOWN, a fault the monitoring system caused itself. On a
 * miss, a non-blocking caller gets an empty inventory immediately while a
 * background fetch warms the cache for the NEXT scrape. Every existing
 * caller omits the flag and keeps blocking, unchanged.
 *
 * `vdcContext` MUST describe the same scope `infra` was resolved under — a
 * narrowed `infra` stored under the union cache key (or vice-versa) poisons
 * the cache: the next reader for the wrong context gets someone else's slice
 * of the inventory (or a truncated one).
 */
export async function getInventorySWR(
  tenantId: string,
  infra: InfraScope,
  forceRefresh = false,
  nonBlocking = false,
  vdcContext: string | null = null,
): Promise<{ raw: RawInventory; cached: boolean }> {
  if (forceRefresh) {
    return { raw: await blockingFetch(tenantId, infra, vdcContext), cached: false }
  }
  const cacheResult = getInventoryFromCache(tenantId, vdcContext)
  if (cacheResult.status === "fresh") {
    return { raw: cacheResult.data as RawInventory, cached: true }
  }
  if (cacheResult.status === "stale") {
    console.log('[inventory] Serving stale data, revalidating in background')
    triggerBackgroundRevalidation(tenantId, infra, vdcContext)
    return { raw: cacheResult.data as RawInventory, cached: true }
  }
  if (nonBlocking) {
    console.log('[inventory] Cold cache, serving empty and warming in background (non-blocking caller)')
    triggerBackgroundRevalidation(tenantId, infra, vdcContext)
    return { raw: emptyRawInventory(), cached: false }
  }
  return { raw: await blockingFetch(tenantId, infra, vdcContext), cached: false }
}
