import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { demoResponse } from "@/lib/demo/demo-api"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { aggregateStorage } from "@/lib/proxmox/storage"

export const runtime = "nodejs"

/**
 * GET /api/v1/storage
 * Récupère tous les storages de toutes les connexions PVE en une seule requête
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
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

            allStorages.push({
              connId: conn.id,
              connName: conn.name,
              node: r.node,
              storage: r.storage,
              type: config.type || 'unknown',
              shared: config.shared === 1 || config.shared === true,
              used: Number(r.disk || 0),
              total: Number(r.maxdisk || 0),
              content: config.content ? String(config.content).split(',') : [],
              enabled: config.disable !== 1,
              status: r.status || (r.disk !== undefined ? 'available' : 'unknown'),
              path: config.path || null,
              server: config.server || null,
              export: config.export || null,
              pool: config.pool || null,
              monhost: config.monhost || null,
              fsName: config['fs-name'] || null,
              datastore: config.datastore || null,
            })
          }
        } catch (e) {
          console.error(`[storage] Error fetching ${conn.name}:`, e)
        }
      })
    )

    // Agréger les storages: jamais fusionner entre clusters (issue #569);
    // au sein d'un cluster, sommer par node pour les storages locaux et
    // collapser au pool pour les storages partagés (aggregateStorage).
    const result = aggregateStorage(allStorages)

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
