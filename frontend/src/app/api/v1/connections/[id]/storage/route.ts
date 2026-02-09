import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Récupérer les ressources de type storage via /cluster/resources
    const resources = await pveFetch<any[]>(conn, "/cluster/resources")
    
    const storageResources = resources.filter((r) => r?.type === "storage")

    // Récupérer aussi la config des storages pour avoir plus d'infos
    // On va récupérer la liste des storages configurés
    let storageConfigs: any[] = []

    try {
      storageConfigs = await pveFetch<any[]>(conn, "/storage")
    } catch {
      // Pas grave si on n'a pas accès
    }

    // Créer un map des configs par storage name
    const configMap = new Map<string, any>()

    for (const cfg of storageConfigs) {
      if (cfg?.storage) {
        configMap.set(cfg.storage, cfg)
      }
    }

    // Mapper les storages
    const storages = storageResources.map((r) => {
      const config = configMap.get(r.storage) || {}
      const used = Number(r.disk || 0)
      const total = Number(r.maxdisk || 0)
      const usedPct = total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0

      // Déterminer le type de storage
      let storageType = config.type || 'unknown'
      
      // Déterminer si c'est un stockage partagé ou local
      const isShared = config.shared === 1 || 
                       ['cephfs', 'rbd', 'nfs', 'cifs', 'glusterfs', 'iscsi', 'iscsidirect', 'pbs'].includes(storageType)

      // Déterminer les contenus supportés
      const content = config.content ? String(config.content).split(',') : []

      return {
        id: `${r.storage}-${r.node}`,
        storage: r.storage,
        node: r.node,
        type: storageType,
        status: r.status || (r.disk !== undefined ? 'available' : 'unknown'),
        enabled: config.disable !== 1,
        shared: isShared,
        content: content,
        
        // Capacité
        used: used,
        total: total,
        usedFormatted: formatBytes(used),
        totalFormatted: formatBytes(total),
        usedPct: usedPct,
        free: total - used,
        freeFormatted: formatBytes(total - used),

        // Config additionnelle
        path: config.path || null,
        server: config.server || null,
        export: config.export || null,
        pool: config.pool || null,
        monhost: config.monhost || null,
        
        // Pour Ceph
        fsName: config['fs-name'] || null,
        
        // Pour PBS
        datastore: config.datastore || null,
        fingerprint: config.fingerprint || null,
      }
    })

    // Agréger les storages partagés (même nom sur plusieurs nodes)
    const aggregatedMap = new Map<string, any>()
    
    for (const s of storages) {
      if (s.shared) {
        // Pour les stockages partagés, on prend une seule entrée par nom de storage
        const key = `${id}:${s.storage}` // Unique par connexion + storage name

        if (!aggregatedMap.has(key)) {
          aggregatedMap.set(key, {
            ...s,
            id: key,
            nodes: [s.node],
          })
        } else {
          // Ajouter le node à la liste et mettre à jour les stats si plus récentes
          const existing = aggregatedMap.get(key)

          if (!existing.nodes.includes(s.node)) {
            existing.nodes.push(s.node)
          }


          // Garder les valeurs les plus à jour (non nulles)
          if (s.used > 0 && existing.used === 0) {
            existing.used = s.used
            existing.usedFormatted = s.usedFormatted
          }

          if (s.total > 0 && existing.total === 0) {
            existing.total = s.total
            existing.totalFormatted = s.totalFormatted
          }

          if (s.usedPct > 0 && existing.usedPct === 0) {
            existing.usedPct = s.usedPct
          }
        }
      } else {
        // Pour les stockages locaux, une entrée par node
        const key = `${id}:${s.storage}:${s.node}`

        aggregatedMap.set(key, {
          ...s,
          id: key,
          nodes: [s.node],
        })
      }
    }

    const result = Array.from(aggregatedMap.values())

    // Trier: partagés d'abord, puis par utilisation décroissante
    result.sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? -1 : 1
      
return b.usedPct - a.usedPct
    })

    return NextResponse.json({ data: result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
