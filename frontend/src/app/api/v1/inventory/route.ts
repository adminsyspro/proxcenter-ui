import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getRBACContext, filterVmsByPermission, PERMISSIONS } from "@/lib/rbac"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

/**
 * GET /api/v1/inventory
 * 
 * API agrégée qui retourne l'arbre complet de l'infrastructure en une seule requête.
 * Optimisé pour charger toutes les connexions, nodes et guests en parallèle côté serveur.
 * 
 * Response:
 * {
 *   data: {
 *     clusters: [
 *       {
 *         id: string,
 *         name: string,
 *         type: 'pve',
 *         isCluster: boolean,
 *         status: 'online' | 'degraded' | 'offline',
 *         nodes: [
 *           {
 *             node: string,
 *             status: 'online' | 'offline',
 *             cpu: number,
 *             mem: number,
 *             maxmem: number,
 *             disk: number,
 *             maxdisk: number,
 *             uptime: number,
 *             guests: [
 *               { vmid, name, type, status, cpu, mem, maxmem, disk, maxdisk, uptime, node }
 *             ]
 *           }
 *         ]
 *       }
 *     ],
 *     stats: {
 *       totalClusters: number,
 *       totalNodes: number,
 *       totalGuests: number,
 *       onlineNodes: number,
 *       runningGuests: number,
 *     }
 *   }
 * }
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
  cephHealth?: string // HEALTH_OK, HEALTH_WARN, HEALTH_ERR ou undefined si pas de Ceph
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

export async function GET() {
  try {
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

    // Si aucune connexion, retourner un inventaire vide
    if (!pveConnections.length && !pbsConnections.length) {
      return NextResponse.json({
        data: {
          clusters: [],
          pbsServers: [],
          stats: {
            totalClusters: 0,
            totalNodes: 0,
            totalGuests: 0,
            onlineNodes: 0,
            runningGuests: 0,
            totalPbsServers: 0,
            totalDatastores: 0,
            totalBackups: 0,
          }
        }
      })
    }

    // 2) Pour chaque connexion PVE, charger nodes et guests EN PARALLÈLE
    const clusterPromises = pveConnections.map(async (conn): Promise<ClusterData | null> => {
      try {
        const connConfig = await getConnectionById(conn.id)
        
        // Charger nodes, guests, HA et Ceph en parallèle pour cette connexion
        const [nodesResult, guestsResult, haResult, cephResult] = await Promise.allSettled([
          pveFetch<NodeData[]>(connConfig, '/nodes'),
          pveFetch<GuestData[]>(connConfig, '/cluster/resources?type=vm'),
          pveFetch<HaResource[]>(connConfig, '/cluster/ha/resources'),
          pveFetch<any>(connConfig, '/cluster/ceph/status'),
        ])

        const nodes: NodeData[] = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
        const guests: GuestData[] = guestsResult.status === 'fulfilled' ? guestsResult.value || [] : []
        const haResources: HaResource[] = haResult.status === 'fulfilled' ? haResult.value || [] : []
        
        // Extraire le statut Ceph (HEALTH_OK, HEALTH_WARN, HEALTH_ERR)
        let cephHealth: string | undefined
        if (cephResult.status === 'fulfilled' && cephResult.value) {
          const cephData = cephResult.value
          if (typeof cephData.health === 'string') {
            cephHealth = cephData.health
          } else if (cephData.health?.status) {
            cephHealth = cephData.health.status
          }
        }

        // Récupérer les IPs et config (maintenance) des nodes en parallèle
        const nodeIpPromises = nodes.map(async (node) => {
          if (!node?.node) return { node: node.node, ip: undefined, maintenance: undefined }

          try {
            const [networks, config] = await Promise.all([
              pveFetch<any[]>(
                connConfig,
                `/nodes/${encodeURIComponent(node.node)}/network`
              ).catch(() => null),
              pveFetch<any>(
                connConfig,
                `/nodes/${encodeURIComponent(node.node)}/config`
              ).catch(() => null),
            ])

            let ip: string | undefined

            if (Array.isArray(networks)) {
              // Priorité aux bridges et interfaces physiques
              for (const iface of networks) {
                const ifaceName = (iface.iface || '').toLowerCase()

                if (ifaceName.startsWith('vmbr') || ifaceName.startsWith('eth') || ifaceName.startsWith('ens') || ifaceName.startsWith('enp')) {
                  if (iface.address && !iface.address.startsWith('127.')) {
                    ip = iface.address
                    break
                  }
                }
              }

              // Fallback: prendre la première IP non-loopback
              if (!ip) {
                for (const iface of networks) {
                  if (iface.address && !iface.address.startsWith('127.')) {
                    ip = iface.address
                    break
                  }
                }
              }
            }

            const maintenance = config?.maintenance as string | undefined

            return { node: node.node, ip, maintenance }
          } catch {
            return { node: node.node, ip: undefined, maintenance: undefined }
          }
        })
        
        const nodeIps = await Promise.all(nodeIpPromises)
        const nodeIpMap = new Map<string, { ip?: string; maintenance?: string }>()

        for (const { node, ip, maintenance } of nodeIps) {
          if (node) nodeIpMap.set(node, { ip, maintenance })
        }

        // Créer une map des ressources HA pour lookup rapide
        const haMap = new Map<string, HaResource>()

        for (const ha of haResources) {
          if (ha.sid) {
            haMap.set(ha.sid, ha)
          }
        }

        // Construire la map nodes -> guests
        const nodeMap = new Map<string, NodeData & { guests: GuestData[] }>()
        
        for (const n of nodes) {
          if (!n?.node) continue
          const extra = nodeIpMap.get(n.node)
          // Config is the authoritative source for maintenance mode.
          // hastate from CRM may lag behind by up to ~120s after config is cleared.
          const maintenance = extra?.maintenance || undefined
          nodeMap.set(n.node, {
            ...n,
            ip: extra?.ip,
            maintenance,
            guests: []
          })
        }

        // Associer les guests aux nodes
        for (const g of guests) {
          if (!g?.node) continue
          
          // Si le node n'existe pas encore (cas rare), le créer
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

            // HA: chercher dans la map
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

        // Trier les guests par vmid dans chaque node
        for (const nodeData of nodeMap.values()) {
          nodeData.guests.sort((a, b) => {
            const aId = parseInt(String(a.vmid), 10) || 0
            const bId = parseInt(String(b.vmid), 10) || 0

            
return aId - bId
          })
        }

        // Déterminer le status du cluster
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

        // Retourner un cluster en erreur plutôt que null
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

    // 3) Attendre toutes les connexions en parallèle
    const clustersResults = await Promise.all(clusterPromises)
    let clusters = clustersResults.filter((c): c is ClusterData => c !== null)

    // 3.5) RBAC: Filtrer les guests selon les permissions
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

    // 4) Pour chaque connexion PBS, charger status et datastores EN PARALLÈLE
    const pbsPromises = pbsConnections.map(async (conn): Promise<PbsServerData | null> => {
      try {
        const connConfig = await getPbsConnectionById(conn.id)

        // Charger status et datastores en parallèle
        const [statusResult, datastoresResult] = await Promise.allSettled([
          pbsFetch<any>(connConfig, '/status'),
          pbsFetch<any[]>(connConfig, '/admin/datastore'),
        ])

        const status = statusResult.status === 'fulfilled' ? statusResult.value : null
        const datastores = datastoresResult.status === 'fulfilled' ? datastoresResult.value || [] : []

        // Récupérer les détails de chaque datastore ET les snapshots en parallèle
        const datastoreDetailsPromises = datastores.map(async (ds): Promise<PbsDatastoreData> => {
          const storeName = ds.store || ds.name

          if (!storeName) {
            return {
              name: 'unknown',
              total: 0,
              used: 0,
              available: 0,
              usagePercent: 0,
              backupCount: 0,
              vmCount: 0,
              ctCount: 0,
              hostCount: 0,
            }
          }

          try {
            // Récupérer status ET snapshots en parallèle
            const [dsStatusResult, snapshotsResult] = await Promise.allSettled([
              pbsFetch<any>(connConfig, `/admin/datastore/${encodeURIComponent(storeName)}/status`),
              pbsFetch<any[]>(connConfig, `/admin/datastore/${encodeURIComponent(storeName)}/snapshots`),
            ])

            const dsStatus = dsStatusResult.status === 'fulfilled' ? dsStatusResult.value : null
            const snapshots = snapshotsResult.status === 'fulfilled' ? snapshotsResult.value || [] : []

            const total = dsStatus?.total || 0
            const used = dsStatus?.used || 0
            const available = dsStatus?.avail || (total - used)
            
            // Compter les snapshots par type
            let vmCount = 0
            let ctCount = 0
            let hostCount = 0

            for (const snap of snapshots) {
              const backupType = snap['backup-type']
              if (backupType === 'vm') vmCount++
              else if (backupType === 'ct') ctCount++
              else if (backupType === 'host') hostCount++
            }

            const backupCount = snapshots.length

            return {
              name: storeName,
              path: ds.path || '',
              comment: ds.comment || '',
              total,
              used,
              available,
              usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
              backupCount,
              vmCount,
              ctCount,
              hostCount,
            }
          } catch {
            return {
              name: storeName,
              path: ds.path || '',
              comment: ds.comment || '',
              total: 0,
              used: 0,
              available: 0,
              usagePercent: 0,
              backupCount: 0,
              vmCount: 0,
              ctCount: 0,
              hostCount: 0,
            }
          }
        })

        const datastoreDetails = await Promise.all(datastoreDetailsPromises)

        // Calculer les stats totales
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
          stats: {
            totalSize,
            totalUsed,
            datastoreCount: datastoreDetails.length,
            backupCount: totalBackups,
          }
        }
      } catch (e: any) {
        console.error(`[inventory] Failed to load PBS ${conn.name}:`, e?.message)
        return {
          id: conn.id,
          name: conn.name,
          type: 'pbs',
          status: 'offline',
          datastores: [],
          stats: {
            totalSize: 0,
            totalUsed: 0,
            datastoreCount: 0,
            backupCount: 0,
          }
        }
      }
    })

    const pbsResults = await Promise.all(pbsPromises)
    const pbsServers = pbsResults.filter((p): p is PbsServerData => p !== null)

    // 5) Calculer les stats globales
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

    // Stats PBS
    let totalDatastores = 0
    let totalBackups = 0

    for (const pbs of pbsServers) {
      totalDatastores += pbs.stats.datastoreCount
      totalBackups += pbs.stats.backupCount
    }

    return NextResponse.json({
      data: {
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
    })
  } catch (e: any) {
    console.error('[inventory] Error:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
