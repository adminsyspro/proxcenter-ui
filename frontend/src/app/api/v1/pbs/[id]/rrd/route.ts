import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/pbs/[id]/rrd
 * 
 * Récupère les données RRD (graphiques) du serveur PBS
 * Query params:
 *   - timeframe: hour | day | week | month | year (default: hour)
 *   - cf: AVERAGE | MAX (default: AVERAGE)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const url = new URL(req.url)
    const timeframe = url.searchParams.get('timeframe') || 'hour'
    const cf = url.searchParams.get('cf') || 'AVERAGE'

    const conn = await getPbsConnectionById(id)

    // PBS utilise /nodes/localhost/rrd pour les métriques du serveur
    // Essayer plusieurs endpoints possibles
    let rrdData: any[] | null = null

    // Endpoint 1: /nodes/localhost/rrd (format standard PBS)
    rrdData = await pbsFetch<any[]>(
      conn,
      `/nodes/localhost/rrd?timeframe=${encodeURIComponent(timeframe)}&cf=${encodeURIComponent(cf)}`
    ).catch(() => null)

    // Endpoint 2: /status/rrd (ancien format)
    if (!rrdData || rrdData.length === 0) {
      rrdData = await pbsFetch<any[]>(
        conn,
        `/status/rrd?timeframe=${encodeURIComponent(timeframe)}&cf=${encodeURIComponent(cf)}`
      ).catch(() => null)
    }

    // Endpoint 3: /rrd (format simplifié)
    if (!rrdData || rrdData.length === 0) {
      rrdData = await pbsFetch<any[]>(
        conn,
        `/rrd?timeframe=${encodeURIComponent(timeframe)}&cf=${encodeURIComponent(cf)}`
      ).catch(() => null)
    }

    if (!rrdData || rrdData.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Transformer les données pour le frontend
    const series = (rrdData || []).map((point: any) => ({
      time: point.time,
      // CPU
      cpu: point.cpu ? Math.round(point.cpu * 100 * 100) / 100 : 0,
      iowait: point.iowait ? Math.round(point.iowait * 100 * 100) / 100 : 0,
      loadavg: point.loadavg || 0,
      // Memory
      memtotal: point.memtotal || 0,
      memused: point.memused || 0,
      memUsedPercent: point.memtotal > 0 ? Math.round((point.memused / point.memtotal) * 100 * 100) / 100 : 0,
      // Swap
      swaptotal: point.swaptotal || 0,
      swapused: point.swapused || 0,
      swapUsedPercent: point.swaptotal > 0 ? Math.round((point.swapused / point.swaptotal) * 100 * 100) / 100 : 0,
      // Network
      netin: point.netin || 0,
      netout: point.netout || 0,
      // Disk I/O
      diskread: point.diskread || 0,
      diskwrite: point.diskwrite || 0,
      // Root disk
      roottotal: point.roottotal || 0,
      rootused: point.rootused || 0,
      rootUsedPercent: point.roottotal > 0 ? Math.round((point.rootused / point.roottotal) * 100 * 100) / 100 : 0,
    }))

    return NextResponse.json({
      data: series,
      timeframe,
      cf,
    })
  } catch (e: any) {
    console.error("PBS RRD error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
