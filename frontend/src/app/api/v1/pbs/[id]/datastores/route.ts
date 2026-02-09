import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getPbsConnectionById(id)

    // Récupérer la liste des datastores
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

    // Enrichir chaque datastore avec des infos supplémentaires
    const enrichedDatastores = await Promise.all(
      (datastores || []).map(async (ds) => {
        // PBS utilise "store" comme nom du datastore
        const storeName = ds.store || ds.name
        
        // Essayer de récupérer les stats du datastore
        let status: any = null

        if (storeName) {
          try {
            status = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/status`)
          } catch (e) {
            // Ignorer les erreurs
          }
        }

        const total = status?.total || ds.total || 0
        const used = status?.used || ds.used || 0
        const available = status?.avail || ds.avail || (total - used)
        const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0

        return {
          name: storeName,
          path: ds.path || '',
          comment: ds.comment || '',

          // Espace disque
          total,
          used,
          available,
          usagePercent,
          totalFormatted: formatBytes(total),
          usedFormatted: formatBytes(used),
          availableFormatted: formatBytes(available),

          // Compteurs de backups (vm + ct + host)
          counts: ds.counts || status?.counts || {},
          vmCount: ds.counts?.vm || status?.counts?.vm || 0,
          ctCount: ds.counts?.ct || status?.counts?.ct || 0,
          hostCount: ds.counts?.host || status?.counts?.host || 0,
          backupCount: (ds.counts?.vm || status?.counts?.vm || 0) + 
                       (ds.counts?.ct || status?.counts?.ct || 0) + 
                       (ds.counts?.host || status?.counts?.host || 0),

          // GC (Garbage Collection)
          gcStatus: status?.['gc-status'] || null,

          // Vérification
          verifyStatus: status?.['verify-status'] || null,
        }
      })
    )

    return NextResponse.json({
      data: enrichedDatastores
    })
  } catch (e: any) {
    console.error("PBS datastores error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
