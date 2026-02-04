import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getPbsConnectionById(id)

    // Récupérer le status du serveur PBS et la liste des datastores
    const [status, version, datastores] = await Promise.all([
      pbsFetch<any>(conn, "/status").catch(() => null),
      pbsFetch<any>(conn, "/version").catch(() => null),
      pbsFetch<any[]>(conn, "/admin/datastore").catch(() => []),
    ])

    // Récupérer les stats de chaque datastore en parallèle
    let totalSize = 0
    let totalUsed = 0

    const datastoreStatsPromises = (datastores || []).map(async (ds) => {
      const storeName = ds.store || ds.name

      if (!storeName) return null
      
      try {
        const dsStatus = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(storeName)}/status`)

        
return {
          name: storeName,
          total: dsStatus?.total || 0,
          used: dsStatus?.used || 0,
          avail: dsStatus?.avail || 0,
        }
      } catch (e) {
        return null
      }
    })

    const datastoreStats = await Promise.all(datastoreStatsPromises)
    
    for (const ds of datastoreStats) {
      if (ds) {
        totalSize += ds.total
        totalUsed += ds.used
      }
    }

    return NextResponse.json({
      data: {
        status: status?.status || 'unknown',
        version: version?.version || 'unknown',
        release: version?.release || '',
        uptime: status?.uptime || 0,
        bootInfo: status?.['boot-info'] || null,
        cpuInfo: status?.cpuinfo || null,
        memory: status?.memory || null,
        load: status?.load || null,
        ksmsharing: status?.ksmsharing || null,

        // Stats calculées
        datastoreCount: datastores?.length || 0,
        totalSize,
        totalUsed,
        usagePercent: totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0,
      }
    })
  } catch (e: any) {
    console.error("PBS status error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
