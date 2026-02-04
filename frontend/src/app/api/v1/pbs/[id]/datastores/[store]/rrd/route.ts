import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/pbs/[id]/datastores/[store]/rrd
 * 
 * Récupère les données RRD (graphiques) d'un datastore PBS
 * Query params:
 *   - timeframe: hour | day | week | month | year (default: hour)
 *   - cf: AVERAGE | MAX (default: AVERAGE)
 */
export async function GET(
  req: Request, 
  ctx: { params: Promise<{ id: string; store: string }> | { id: string; store: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const store = (params as any)?.store

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    if (!store) return NextResponse.json({ error: "Missing params.store" }, { status: 400 })

    const url = new URL(req.url)
    const timeframe = url.searchParams.get('timeframe') || 'hour'
    const cf = url.searchParams.get('cf') || 'AVERAGE'

    const conn = await getPbsConnectionById(id)

    // PBS utilise /admin/datastore/{store}/rrd pour les métriques du datastore
    const rrdData = await pbsFetch<any[]>(
      conn,
      `/admin/datastore/${encodeURIComponent(store)}/rrd?timeframe=${encodeURIComponent(timeframe)}&cf=${encodeURIComponent(cf)}`
    ).catch(() => null)

    if (!rrdData) {
      return NextResponse.json({ data: [] })
    }

    // Transformer les données pour le frontend
    const series = (rrdData || []).map((point: any) => ({
      time: point.time,
      // Storage usage
      total: point.total || 0,
      used: point.used || 0,
      available: point.avail || (point.total || 0) - (point.used || 0),
      usedPercent: point.total > 0 ? Math.round((point.used / point.total) * 100 * 100) / 100 : 0,
      // Transfer Rate - PBS peut utiliser read_bytes/write_bytes ou read/write
      read: point.read_bytes || point.read || 0,
      write: point.write_bytes || point.write || 0,
      // IOPS - PBS peut utiliser read_ios/write_ios ou io-read/io-write
      readIops: point.read_ios || point['io-read'] || point.io_read || 0,
      writeIops: point.write_ios || point['io-write'] || point.io_write || 0,
    }))

    return NextResponse.json({
      data: series,
      timeframe,
      cf,
      store,
    })
  } catch (e: any) {
    console.error("PBS Datastore RRD error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
