import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/:id/rrd?path=/nodes/<node>[/qemu/<vmid>|/lxc/<vmid>]&timeframe=hour|day|week|month|year
 * -> proxy vers Proxmox: <path>/rrddata?timeframe=...&cf=AVERAGE
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const url = new URL(req.url)
    const path = url.searchParams.get("path") || ""
    const timeframe = url.searchParams.get("timeframe") || "hour"

    // Sécurité minimale: autoriser uniquement /nodes/...
    if (!path.startsWith("/nodes/")) {
      return NextResponse.json({ error: "Invalid path (must start with /nodes/)" }, { status: 400 })
    }

    const allowed = new Set(["hour", "day", "week", "month", "year"])
    const tf = allowed.has(timeframe) ? timeframe : "hour"

    const conn = await getConnectionById(id)
    const rrdPath = `${path.replace(/\/$/, "")}/rrddata?timeframe=${encodeURIComponent(tf)}&cf=AVERAGE`

    const data = await pveFetch<any[]>(conn, rrdPath)

    
return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

