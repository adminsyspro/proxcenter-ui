import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * GET /api/v1/storage
 * Récupère tous les storages de toutes les connexions PVE en une seule requête
 */
export async function GET() {
  try {
    // RBAC: Check storage.view permission
    const denied = await checkPermission(PERMISSIONS.STORAGE_VIEW)

    if (denied) return denied

    // Récupérer uniquement les connexions PVE (pas PBS)
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: 'desc' }
    })

    if (connections.length === 0) {
      return NextResponse.json({ data: [], connections: [] })
    }

    const allStorages: any[] = []

    // Récupérer les storages de toutes les connexions en parallèle
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connData = await getConnectionById(conn.id)

          // Récupérer resources et config en parallèle
          const [resourcesResult, configResult] = await Promise.allSettled([
            pveFetch<any[]>(connData, "/cluster/resources"),
            pveFetch<any[]>(connData, "/storage")
          ])

          const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
          const storageConfigs = configResult.status === 'fulfilled' ? configResult.value || [] : []

          const storageResources = resources.filter((r: any) => r?.type === "storage")

          // Créer un map des configs par storage name
          const configMap = new Map<string, any>()

          for (const cfg of storageConfigs) {
            if (cfg?.storage) {
              configMap.set(cfg.storage, cfg)
            }
          }

          // Mapper les storages
          for (const r of storageResources) {
            const config = configMap.get(r.storage) || {}
            const used = Number(r.disk || 0)
            const total = Number(r.maxdisk || 0)
            const usedPct = total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0

            let storageType = config.type || 'unknown'

            const isShared = config.shared === 1 || 
                           ['cephfs', 'rbd', 'nfs', 'cifs', 'glusterfs', 'iscsi', 'iscsidirect', 'pbs'].includes(storageType)

            const content = config.content ? String(config.content).split(',') : []

            allStorages.push({
              storage: r.storage,
              node: r.node,
              type: storageType,
              status: r.status || (r.disk !== undefined ? 'available' : 'unknown'),
              enabled: config.disable !== 1,
              shared: isShared,
              content: content,
              used,
              total,
              usedFormatted: formatBytes(used),
              totalFormatted: formatBytes(total),
              usedPct,
              free: total - used,
              freeFormatted: formatBytes(total - used),
              path: config.path || null,
              server: config.server || null,
              export: config.export || null,
              pool: config.pool || null,
              monhost: config.monhost || null,
              fsName: config['fs-name'] || null,
              datastore: config.datastore || null,
              connId: conn.id,
              connectionName: conn.name,
            })
          }
        } catch (e) {
          console.error(`[storage] Error fetching ${conn.name}:`, e)
        }
      })
    )

    // Dédupliquer et agréger les storages
    const deduplicatedMap = new Map<string, any>()

    for (const s of allStorages) {
      // Ceph RBD : ne pas dédupliquer entre connexions (pools différents)
      if (s.type === 'rbd') {
        const key = `${s.connId}:${s.storage}`

        if (!deduplicatedMap.has(key)) {
          deduplicatedMap.set(key, {
            ...s,
            id: key,
            connections: [{ id: s.connId, name: s.connectionName }],
            allNodes: [s.node],
            connectionDetails: [{
              id: s.connId,
              name: s.connectionName,
              nodes: [s.node],
              used: s.used,
              total: s.total,
              usedPct: s.usedPct,
              usedFormatted: s.usedFormatted,
              totalFormatted: s.totalFormatted,
            }]
          })
        } else {
          const existing = deduplicatedMap.get(key)

          if (!existing.allNodes.includes(s.node)) {
            existing.allNodes.push(s.node)
          }
        }
      } else {
        // Tous les autres stockages : dédupliquer par nom
        const key = s.storage

        if (!deduplicatedMap.has(key)) {
          deduplicatedMap.set(key, {
            ...s,
            id: key,
            connections: [{ id: s.connId, name: s.connectionName }],
            allNodes: [s.node],
            connectionDetails: [{
              id: s.connId,
              name: s.connectionName,
              nodes: [s.node],
              used: s.used,
              total: s.total,
              usedPct: s.usedPct,
              usedFormatted: s.usedFormatted,
              totalFormatted: s.totalFormatted,
            }]
          })
        } else {
          const existing = deduplicatedMap.get(key)
          
          // Ajouter les nodes
          if (!existing.allNodes.includes(s.node)) {
            existing.allNodes.push(s.node)
          }
          
          // Ajouter la connexion si nouvelle
          if (!existing.connections.find((c: any) => c.id === s.connId)) {
            existing.connections.push({ id: s.connId, name: s.connectionName })
            existing.connectionDetails.push({
              id: s.connId,
              name: s.connectionName,
              nodes: [s.node],
              used: s.used,
              total: s.total,
              usedPct: s.usedPct,
              usedFormatted: s.usedFormatted,
              totalFormatted: s.totalFormatted,
            })
          } else {
            // Même connexion, ajouter le node aux détails
            const connDetail = existing.connectionDetails.find((c: any) => c.id === s.connId)

            if (connDetail && !connDetail.nodes.includes(s.node)) {
              connDetail.nodes.push(s.node)
            }
          }

          // Mettre à jour les totaux (prendre le max pour les stockages partagés)
          if (s.total > existing.total) {
            existing.total = s.total
            existing.totalFormatted = s.totalFormatted
          }

          if (s.used > existing.used) {
            existing.used = s.used
            existing.usedFormatted = s.usedFormatted
            existing.usedPct = s.usedPct
          }
        }
      }
    }

    const result = Array.from(deduplicatedMap.values())

    // Trier: partagés d'abord, puis par utilisation décroissante
    result.sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? -1 : 1
      
return b.usedPct - a.usedPct
    })

    // Calculer les stats globales
    const stats = {
      total: result.length,
      shared: result.filter(s => s.shared).length,
      local: result.filter(s => !s.shared).length,
      byType: {} as Record<string, number>,
      totalCapacity: 0,
      usedCapacity: 0,
    }

    for (const s of result) {
      stats.byType[s.type] = (stats.byType[s.type] || 0) + 1
      stats.totalCapacity += s.total || 0
      stats.usedCapacity += s.used || 0
    }

    return NextResponse.json({
      data: result,
      stats,
      connections: connections.map(c => ({ id: c.id, name: c.name }))
    })
  } catch (e: any) {
    console.error("[storage] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
