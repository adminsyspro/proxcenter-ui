import { NextRequest } from "next/server"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { demoResponse } from "@/lib/demo/demo-api"
import { getConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { scopePbsDataForTenant, type PbsServerData, type PbsDatastoreData } from "@/lib/inventory/scopePbs"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { aggregateStorage, isSharedStorage, type AggregatedStorage } from "@/lib/proxmox/storage"
import { getRBACContext, filterVmsByPermission, PERMISSIONS, checkPermission, getRbacInfraScope, applyRbacInfraFilter, filterStorageDataForRbac, filterVisibleConnections, filterCandidateConnections, hasStorageGrant, isConnectionVisible, mayHaveVisibleGuests, pruneEmptyConnections, type RbacInfraScope } from "@/lib/rbac"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { readPools, readStorageResources, type PoolFacts } from "@/lib/inventory/proxmoxProjections"
import { attachGuestDiskTotals, onlineNodeSet } from "@/lib/inventory/guestDiskTotals"
import {
  getInflightFetch,
  getInventoryFromCache,
  type CachedInventory,
} from "@/lib/cache/inventoryCache"
import {
  getSharedInventoryFetch,
  joinOrStartInventoryFetch,
  type InventoryFetchEvent,
  type InventoryProducer,
  type SharedInventoryFetch,
} from "@/lib/inventory/sharedInventoryFetch"
import { applyVdcFilter, type VdcScope } from "@/lib/vdc/scope"
import { getVdcContext } from "@/lib/vdc/context"
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope, type InfraScope } from "@/lib/tenant/infraScope"

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
 *
 * On a cache miss, every reader of the same (tenant, vDC context) shares one
 * fan-out and narrows its events to its own grants (#125, sharedInventoryFetch).
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
  maxcpu?: number
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
  lock?: string  // PVE lock type: "migrate", "backup", "snapshot", etc.
  /** Sum of every attached disk, from the guest config (#938). */
  diskTotal?: number
}

type HaResource = {
  sid: string
  state: string
  group?: string
}

/** A pool as Proxmox declares it, empty ones included (issue #978). */
type PoolData = PoolFacts

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
  pools?: PoolData[]
  nodes: Array<NodeData & { guests: GuestData[] }>
}

type StorageItem = {
  storage: string
  node: string
  type: string           // dir, lvm, lvmthin, zfspool, rbd, cephfs, nfs, cifs, etc.
  shared: boolean
  content: string[]      // images, rootdir, iso, backup, snippets, vztmpl
  used: number
  total: number
  usedPct: number
  status: string         // active, inactive
  enabled: boolean
  path?: string
}

type StorageData = {
  connId: string
  connName: string
  isCluster: boolean
  nodes: Array<{
    node: string
    status: string
    storages: StorageItem[]
  }>
  sharedStorages: StorageItem[]
}

/**
 * Restrict a StorageData payload to what the tenant's vDC allows:
 * only the assigned nodes, only the non-shared storages, and the vDC's
 * allowlist of storage IDs. Returns null if nothing remains for this
 * connection (caller should skip the send).
 */
function scopeStorageDataForTenant(
  data: StorageData,
  scope: VdcScope | null
): StorageData | null {
  if (!scope) return data
  const allowedNodes = scope.nodesByConnection.get(data.connId)
  const allowedStorages = scope.storagesByConnection.get(data.connId)
  if (!allowedNodes || !allowedStorages || allowedNodes.size === 0 || allowedStorages.size === 0) {
    return null
  }
  const nodes = data.nodes
    .filter(n => allowedNodes.has(n.node))
    .map(n => ({
      ...n,
      storages: n.storages.filter(s => !s.shared && allowedStorages.has(s.storage)),
    }))
  return { ...data, nodes, sharedStorages: [] }
}

// scopePbsDataForTenant + the PBS payload types are extracted to
// @/lib/inventory/scopePbs (testable module; route files cannot export
// non-handler symbols).

/** The tree's storages for clusters read from the cache: the connection's
 *  owner tenant is not part of the cached cluster, so it is read back first. */
async function fetchStoragesForCachedClusters(clusters: ClusterData[]): Promise<StorageData[]> {
  if (clusters.length === 0) return []
  const conns = await globalPrisma.connection.findMany({
    where: { id: { in: clusters.map(c => c.id) } },
    select: { id: true, name: true, type: true, tenantId: true },
  })
  const byId = new Map(conns.map(c => [c.id, c]))

  return Promise.all(clusters.map(cluster =>
    fetchStoragesForCluster(byId.get(cluster.id) ?? { id: cluster.id, name: cluster.name, type: cluster.type }, cluster)))
}

/* ------------------------------------------------------------------ */
/* Per-connection fetch functions (reused from inventory route)         */
/* ------------------------------------------------------------------ */

async function fetchOneCluster(conn: {
  id: string; name: string; type: string;
  latitude?: number | null; longitude?: number | null;
  locationLabel?: string | null; sshEnabled?: boolean | null;
  tenantId?: string | null
}): Promise<ClusterData> {
  try {
    const connConfig = await getConnectionById(conn.id, conn.tenantId || undefined)

    // Call /nodes FIRST to establish failover cache if the primary is down.
    // This prevents the race condition where parallel calls fail before failover activates.
    let nodes: NodeData[] = []
    let nodesKnown = true
    try {
      nodes = await pveFetch<NodeData[]>(connConfig, '/nodes') || []
    } catch {
      // Primary failed — failover may have been activated. Retry once.
      try {
        nodes = await pveFetch<NodeData[]>(connConfig, '/nodes') || []
      } catch {
        // Still failing — continue with empty nodes, VMs will create synthetic entries
        nodesKnown = false
      }
    }

    const [guestsResult, haResult, cephResult, nodeResourcesResult, poolsResult] = await Promise.allSettled([
      pveFetch<GuestData[]>(connConfig, '/cluster/resources?type=vm'),
      pveFetch<HaResource[]>(connConfig, '/cluster/ha/resources'),
      pveFetch<any>(connConfig, '/cluster/ceph/status'),
      pveFetch<any[]>(connConfig, '/cluster/resources?type=node'),
      // #978: an empty pool is named by no member, so no `type=` projection
      // above ever mentions it. `/pools` is the only list that does.
      pveFetch<any[]>(connConfig, '/pools'),
    ])

    const guests: GuestData[] = guestsResult.status === 'fulfilled' ? guestsResult.value || [] : []
    const haResources: HaResource[] = haResult.status === 'fulfilled' ? haResult.value || [] : []
    const nodeResources: any[] = nodeResourcesResult.status === 'fulfilled' ? nodeResourcesResult.value || [] : []

    const pools = readPools(poolsResult.status === 'fulfilled' ? poolsResult.value : null)

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
        cpu: g.cpu, maxcpu: g.maxcpu, mem: g.mem, maxmem: g.maxmem,
        disk: g.disk, maxdisk: g.maxdisk,
        uptime: g.uptime, pool: g.pool, tags: g.tags,
        lock: g.lock,
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
        const aId = Number.parseInt(String(a.vmid), 10) || 0
        const bId = Number.parseInt(String(b.vmid), 10) || 0
        return aId - bId
      })
    }

    // #938: one /config per guest, cached across polls (guestDiskTotals.ts).
    await attachGuestDiskTotals(
      connConfig,
      conn.id,
      Array.from(nodeMap.values()).flatMap(n => n.guests),
      { onlineNodes: nodesKnown ? onlineNodeSet(nodes) : null },
    )

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
      pools,
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
      pools: [],
      nodes: [],
    }
  }
}

async function fetchStoragesForCluster(conn: {
  id: string; name: string; type: string; tenantId?: string | null
}, clusterData: ClusterData, rollup?: AggregatedStorage[]): Promise<StorageData> {
  try {
    // Pass the connection's own tenantId so the provider (global query) can
    // fetch storages for clusters owned by MSP tenants, not just default-owned.
    const connConfig = await getConnectionById(conn.id, conn.tenantId || undefined)

    // Fetch storage resources (per-node status) and storage config (content types, shared flag)
    const [resourcesResult, configResult] = await Promise.allSettled([
      pveFetch<any[]>(connConfig, '/cluster/resources?type=storage'),
      pveFetch<any[]>(connConfig, '/storage'),
    ])

    const resources: any[] = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
    const configs: any[] = configResult.status === 'fulfilled' ? configResult.value || [] : []
    // The metrics rollup fetchRawInventory caches as `storageResources`, from
    // the same rows: an entry this route writes is then complete for both
    // readers of the shared cache.
    rollup?.push(...aggregateStorage(readStorageResources(resources, conn.id, conn.name)))

    // Build config lookup map
    const configMap = new Map<string, any>()
    for (const cfg of configs) {
      if (cfg?.storage) configMap.set(cfg.storage, cfg)
    }

    // Build storage items from resources (these have per-node usage data)
    const allItems: StorageItem[] = []
    for (const r of resources) {
      if (!r?.storage || !r?.node) continue
      const cfg = configMap.get(r.storage)
      const contentStr: string = cfg?.content || r?.content || ''
      const shared = cfg?.shared === 1 || cfg?.shared === true || false
      const enabled = r?.status === 'available' || r?.enabled !== 0

      allItems.push({
        storage: r.storage,
        node: r.node,
        type: cfg?.type || r?.plugintype || 'unknown',
        shared,
        content: contentStr ? contentStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        used: r.used || r.disk || 0,
        total: r.maxdisk || r.total || 0,
        usedPct: r.maxdisk > 0 ? Math.round((r.used || r.disk || 0) / r.maxdisk * 100) : 0,
        status: r.status === 'available' ? 'active' : 'inactive',
        enabled,
        path: cfg?.path,
      })
    }

    // Separate shared vs local storages
    // For shared storages, pick one representative entry (they have same config but per-node usage)
    const sharedSet = new Map<string, StorageItem>()
    const nodeStorages = new Map<string, StorageItem[]>()

    for (const item of allItems) {
      if (isSharedStorage(item)) {
        // For shared storages, aggregate usage across nodes
        if (!sharedSet.has(item.storage)) {
          sharedSet.set(item.storage, { ...item, node: '' })
        } else {
          // Keep max usage info
          const existing = sharedSet.get(item.storage)!
          existing.used = Math.max(existing.used, item.used)
          existing.total = Math.max(existing.total, item.total)
          existing.usedPct = existing.total > 0 ? Math.round(existing.used / existing.total * 100) : 0
        }
      } else {
        if (!nodeStorages.has(item.node)) nodeStorages.set(item.node, [])
        nodeStorages.get(item.node)!.push(item)
      }
    }

    // Build nodes array from cluster data
    const nodes = clusterData.nodes.map(n => ({
      node: n.node,
      status: n.status,
      storages: (nodeStorages.get(n.node) || []).sort((a, b) => a.storage.localeCompare(b.storage)),
    }))

    return {
      connId: conn.id,
      connName: conn.name,
      isCluster: clusterData.isCluster,
      nodes: nodes.sort((a, b) => a.node.localeCompare(b.node)),
      sharedStorages: Array.from(sharedSet.values()).sort((a, b) => a.storage.localeCompare(b.storage)),
    }
  } catch (e: any) {
    console.error(`[inventory-stream] Failed to load storages for ${conn.name}:`, e?.message)
    return {
      connId: conn.id,
      connName: conn.name,
      isCluster: false,
      nodes: [],
      sharedStorages: [],
    }
  }
}

async function fetchOnePbs(conn: { id: string; name: string }): Promise<PbsServerData> {
  try {
    const connConfig = await getPbsConnectionByIdUnscoped(conn.id)

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

/**
 * Scope one cluster for the current viewer: per-guest RBAC filter, then the
 * vDC mask, then the RBAC node prune. Returns null when the cluster must not be
 * sent at all (nothing left to show and no outright grant on it).
 */
async function scopeClusterForViewer(
  cluster: ClusterData,
  rbacCtx: any,
  mask: VdcScope | null,
  rbacScope: RbacInfraScope | null,
): Promise<ClusterData | null> {
  let result = cluster
  if (rbacCtx && !rbacCtx.isAdmin) {
    const filteredNodes = await Promise.all(
      cluster.nodes.map(async node => ({
        ...node,
        guests: await filterVmsByPermission(
          rbacCtx.userId,
          node.guests.map(g => ({
            ...g,
            connId: cluster.id,
            node: node.node,
            vmid: String(g.vmid),
          })),
          PERMISSIONS.VM_VIEW,
          rbacCtx.tenantId
        )
      }))
    )
    result = { ...cluster, nodes: filteredNodes }
  }
  // vDC mask first (it also drops guests by pool), then the RBAC node prune, so
  // a guest-derived perimeter is computed on the final guest set (issue #633).
  const scoped = applyRbacInfraFilter(applyVdcFilter(result, mask), rbacScope)
  const kept = pruneEmptyConnections([scoped], rbacScope)
  return kept.length > 0 ? kept[0] : null
}

/** Who reads the stream: everything the narrowing of a raw payload needs. */
type Viewer = {
  rbacCtx: any
  /** null = admin/unrestricted (no pruning) */
  rbacScope: RbacInfraScope | null
  mask: VdcScope | null
}

/**
 * Storage is host data, not guest data: a guest-derived (tag/pool) perimeter
 * must never surface it, or the candidate set of the clusters would hand a
 * tag-scoped user the storage layout of every connection (issue #633). Same
 * predicate on the cached and the live path, so both answer identically
 * whatever the cache state.
 */
function isStorageVisible(viewer: Viewer, connId: string): boolean {
  return (!viewer.mask || viewer.mask.connectionIds.has(connId)) &&
    (!viewer.rbacScope || isConnectionVisible(viewer.rbacScope, connId) || hasStorageGrant(viewer.rbacScope, connId))
}

/** Tenant mask, then the RBAC storage rule (issue #921): a node grant shows
 *  that node's storages and the shared ones, a storage grant shows the storage
 *  it names, nothing else of the cluster. */
function scopeStorageForViewer(storage: StorageData, viewer: Viewer): StorageData | null {
  const scoped = scopeStorageDataForTenant(storage, viewer.mask)
  return scoped ? filterStorageDataForRbac(scoped, viewer.rbacScope) : null
}

const encoder = new TextEncoder()

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/* ------------------------------------------------------------------ */
/* Cached entry → quick burst                                          */
/* ------------------------------------------------------------------ */

function streamCached(cached: CachedInventory, viewer: Viewer): Response {
  const { rbacCtx, rbacScope, mask } = viewer
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Filter clusters by vDC scope then RBAC infra scope (intersection).
        // Candidate set only: a guest-derived scope is resolved per cluster below.
        let visibleClusters = mask ? cached.clusters.filter(c => mask.connectionIds.has(c.id)) : cached.clusters
        visibleClusters = filterCandidateConnections(visibleClusters, rbacScope)

        const visiblePbs = filterVisibleConnections(cached.pbsServers, rbacScope)
        const visibleExt = filterVisibleConnections(cached.externalHypervisors, rbacScope)

        const scopedClusters: ClusterData[] = []
        for (const cluster of visibleClusters) {
          const scoped = await scopeClusterForViewer(cluster, rbacCtx, mask, rbacScope)
          if (scoped) scopedClusters.push(scoped)
        }

        send('init', {
          totalPve: scopedClusters.length,
          totalPbs: visiblePbs.length,
          totalExt: visibleExt.length,
          cached: true,
        })

        for (const cluster of scopedClusters) {
          send('cluster', cluster)
        }
        for (const pbs of visiblePbs) {
          const scoped = await scopePbsDataForTenant(pbs, mask)
          if (scoped) send('pbs', scoped)
        }
        // The cache has two producers (#938 recette, #921): fetchRawInventory,
        // behind /api/v1/inventory and the Prometheus scrape, writes the
        // entry WITHOUT the tree's `storages`. Serving it as is left the tree
        // with no STORAGE section until the next cache miss. The two storage
        // calls per cluster are fetched here instead, and kept on the entry
        // (same object as the cache's) for the next reader.
        if (!Array.isArray(cached.storages)) {
          cached.storages = await fetchStoragesForCachedClusters(cached.clusters)
        }
        if (cached.storages) {
          // Storage is keyed by connId, not id, so the RBAC gate is spelled out here.
          const visibleStorages = cached.storages.filter((s: any) => isStorageVisible(viewer, s.connId))
          for (const storage of visibleStorages) {
            // Shape guard: the tree reads nodes[] and sharedStorages[] and
            // dies on anything else. A cache written by another producer
            // under this key must be skipped, not forwarded.
            if (!Array.isArray(storage?.nodes) || !Array.isArray(storage?.sharedStorages)) continue
            const visible = scopeStorageForViewer(storage, viewer)
            if (visible) send('storage', visible)
          }
        }
        if (visibleExt.length > 0) {
          send('external', visibleExt)
        }
        send('done', { stats: cached.stats })
      } finally {
        controller.close()
      }
    }
  })

  return sseResponse(stream)
}

/* ------------------------------------------------------------------ */
/* Cache miss → one shared fan-out, narrowed per reader                */
/* ------------------------------------------------------------------ */

/**
 * The fan-out over the whole scope of `infra`, for any viewer: it is shared by
 * every reader of the scope and its result is cached under the scope's key
 * (#125). PBS included: narrowing them to the first reader's grants cached a
 * PBS-less inventory that the tenant's admin was then served for 15 minutes.
 */
function inventoryProducer(
  prisma: Awaited<ReturnType<typeof getSessionPrisma>>,
  infra: InfraScope,
): InventoryProducer {
  const plan = inventoryConnectionPlan(infra)

  return async emit => {
    const startTime = Date.now()

    // provider → globalPrisma, all connections; msp → session prisma, own connections;
    // iaas (vDC tenant) → globalPrisma restricted to vDC-bound connection IDs
    const connSelect = { id: true, name: true, type: true, latitude: true, longitude: true, locationLabel: true, sshEnabled: true, tenantId: true } as const
    const pveClient = plan.pveClient === 'global' ? globalPrisma : prisma
    const pveWhere = plan.pveConnectionIds
      ? { type: 'pve' as const, id: { in: plan.pveConnectionIds } }
      : { type: 'pve' as const }

    // PBS: iaas surfaces its vDC-bound PBS (global + bound ids); provider
    // sees all (global); msp sees its own (session).
    let pbsWhere: { type: 'pbs'; id?: { in: string[] } }
    let pbsUseGlobal: boolean
    if (infra.kind === 'iaas') {
      pbsUseGlobal = true
      pbsWhere = { type: 'pbs', id: { in: [...infra.vdcScope.pbsNamespacesByConnection.keys()] } }
    } else {
      pbsUseGlobal = plan.pbsExtClient === 'global'
      pbsWhere = { type: 'pbs' }
    }
    const extUseGlobal = plan.pbsExtClient === 'global'

    const [pveConnections, pbsConnections, externalConnections] = await Promise.all([
      pveClient.connection.findMany({ where: pveWhere, orderBy: { createdAt: 'desc' }, select: connSelect }),
      (pbsUseGlobal ? globalPrisma : prisma).connection.findMany({ where: pbsWhere, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, type: true } }),
      (extUseGlobal ? globalPrisma : prisma).connection.findMany({ where: { type: { in: ['vmware', 'hyperv', 'xcpng', 'nutanix'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, type: true } }),
    ])

    emit({ kind: 'connections', pve: pveConnections, pbs: pbsConnections, external: externalConnections })

    // Fire all fetches concurrently — each emits as soon as it is ready
    const allClusters: ClusterData[] = []
    const allPbsServers: PbsServerData[] = []
    const allStorages: StorageData[] = []
    const allStorageResources: AggregatedStorage[] = []

    const clusterPromises = pveConnections.map(async (conn) => {
      const cluster = await fetchOneCluster(conn)
      allClusters.push(cluster)
      emit({ kind: 'cluster', data: cluster })

      const storageData = await fetchStoragesForCluster(conn, cluster, allStorageResources)
      allStorages.push(storageData)
      emit({ kind: 'storage', data: storageData })
    })

    const pbsPromises = pbsConnections.map(async (conn) => {
      const pbs = await fetchOnePbs(conn)
      allPbsServers.push(pbs)
      emit({ kind: 'pbs', data: pbs })
    })

    await Promise.allSettled([...clusterPromises, ...pbsPromises])

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

    console.log(`[inventory-stream] Streamed all data in ${Date.now() - startTime}ms`)

    return {
      clusters: allClusters,
      pbsServers: allPbsServers,
      externalHypervisors: externalConnections,
      storages: allStorages,
      storageResources: allStorageResources,
      stats: {
        totalClusters: allClusters.length,
        totalNodes, totalGuests, onlineNodes, runningGuests,
        totalPbsServers: allPbsServers.length,
        totalDatastores, totalBackups,
      },
    }
  }
}

/** One reader of a shared fan-out: its events, narrowed to what this viewer may see. */
function streamShared(shared: SharedInventoryFetch, viewer: Viewer): Response {
  const { rbacCtx, rbacScope, mask } = viewer
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Client disconnected
        }
      }

      // Set by the `connections` event, which always comes first.
      let isVisibleConn: (connId: string) => boolean = () => false
      let visiblePbsIds = new Set<string>()

      const handle = async (ev: InventoryFetchEvent) => {
        switch (ev.kind) {
          case 'connections': {
            // A PVE connection is streamed only if it passes BOTH the vDC mask
            // and the RBAC candidate prune. A guest-derived (tag/pool) scope
            // keeps every connection here and is resolved per cluster.
            isVisibleConn = (connId: string) =>
              (!mask || mask.connectionIds.has(connId)) &&
              (!rbacScope || mayHaveVisibleGuests(rbacScope, connId))
            const visiblePbs = filterVisibleConnections(ev.pbs, rbacScope)
            const visibleExt = filterVisibleConnections(ev.external, rbacScope)
            visiblePbsIds = new Set(visiblePbs.map(c => c.id))

            send('init', {
              totalPve: ev.pve.filter(c => isVisibleConn(c.id)).length,
              totalPbs: visiblePbs.length,
              totalExt: visibleExt.length,
              cached: false,
            })
            // External hypervisors need no fetch
            if (visibleExt.length > 0) send('external', visibleExt)
            break
          }
          case 'cluster': {
            if (!isVisibleConn(ev.data.id)) break
            const scoped = await scopeClusterForViewer(ev.data, rbacCtx, mask, rbacScope)
            if (scoped) send('cluster', scoped)
            break
          }
          case 'storage': {
            if (!isStorageVisible(viewer, ev.data.connId)) break
            const visible = scopeStorageForViewer(ev.data, viewer)
            if (visible) send('storage', visible)
            break
          }
          case 'pbs': {
            if (!visiblePbsIds.has(ev.data.id)) break
            const scoped = await scopePbsDataForTenant(ev.data, mask)
            if (scoped) send('pbs', scoped)
            break
          }
        }
      }

      // One event at a time, in order: `done` must follow the last cluster.
      let queue: Promise<void> = Promise.resolve()
      unsubscribe = shared.subscribe(ev => {
        queue = queue.then(() => handle(ev)).catch(e => {
          console.error('[inventory-stream] Narrowing failed:', e?.message)
        })
      })

      shared.result
        .then(
          data => queue.then(() => send('done', { stats: data.stats })),
          e => queue.then(() => {
            console.error('[inventory-stream] Error:', e?.message)
            send('error', { message: e?.message || String(e) })
          }),
        )
        .finally(() => {
          unsubscribe?.()
          try { controller.close() } catch { /* already closed by the client */ }
        })
    },
    cancel() {
      // The fan-out keeps running for the other readers and the cache.
      unsubscribe?.()
    },
  })

  return sseResponse(stream)
}

/* ------------------------------------------------------------------ */
/* GET handler — SSE stream                                            */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const demo = demoResponse(request)
  if (demo) return demo

  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied

  const prisma = await getSessionPrisma()
  const tenantId = await getCurrentTenantId()
  // Resolved BEFORE the cache read below: this route is session-only (not
  // in the API-token allowlist, cf. allowlist.ts), so the view cookie always
  // applies — no isTokenPrincipal opt-out needed here (unlike inventory/route.ts).
  const vdcContext = await getVdcContext(tenantId)
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  const rbacCtx = await getRBACContext()
  const infra = await getTenantInfrastructureScope(tenantId)
  const viewer: Viewer = {
    rbacCtx,
    rbacScope: rbacCtx && !rbacCtx.isAdmin ? await getRbacInfraScope(rbacCtx.userId, rbacCtx.tenantId) : null,
    mask: maskingScope(infra),
  }

  const cacheResult = forceRefresh ? { status: 'miss' as const } : getInventoryFromCache(tenantId, vdcContext)

  if (cacheResult.status === 'fresh' || cacheResult.status === 'stale') {
    // Served now, refreshed for the next reader, unless a fetch of this scope
    // (ours or /api/v1/inventory's) is already running.
    if (cacheResult.status === 'stale' && !getInflightFetch(tenantId, vdcContext)) {
      joinOrStartInventoryFetch(tenantId, vdcContext, inventoryProducer(prisma, infra))
    }
    return streamCached(cacheResult.data, viewer)
  }

  // A blocking read of /api/v1/inventory is already fetching this scope:
  // wait for it rather than fetch everything a second time.
  if (!forceRefresh && !getSharedInventoryFetch(tenantId, vdcContext)) {
    const pending = getInflightFetch(tenantId, vdcContext)
    if (pending) {
      try {
        return streamCached(await pending, viewer)
      } catch {
        // It failed: fetch for ourselves below.
      }
    }
  }

  const shared = joinOrStartInventoryFetch(tenantId, vdcContext, inventoryProducer(prisma, infra), { force: forceRefresh })
  return streamShared(shared, viewer)
}
