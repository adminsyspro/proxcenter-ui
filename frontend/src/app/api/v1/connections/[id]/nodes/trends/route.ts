import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n))
}

// Max points per timeframe — keep enough for full period visibility
const MAX_POINTS: Record<string, number> = {
  hour: 70,   // ~1min resolution
  day: 288,   // ~5min resolution
  week: 336,  // ~30min resolution (downsampled)
}

function formatTimestamp(d: Date, timeframe: string) {
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")

  if (timeframe === "week") {
    const dd = String(d.getDate()).padStart(2, "0")
    const mo = String(d.getMonth() + 1).padStart(2, "0")
    return `${dd}/${mo} ${hh}:${mm}`
  }
  return `${hh}:${mm}`
}

function downsample(points: any[], maxLen: number) {
  if (points.length <= maxLen) return points
  const step = points.length / maxLen
  const result = []
  for (let i = 0; i < maxLen; i++) {
    result.push(points[Math.floor(i * step)])
  }
  return result
}

function toTrendPoints(rrd: any[], timeframe: string) {
  const arr = Array.isArray(rrd) ? rrd : []
  const points = arr.filter((p) => p && typeof p.time === "number")
  const maxPts = MAX_POINTS[timeframe] || 70
  const tail = downsample(points.length > maxPts ? points.slice(-maxPts * 2) : points, maxPts)

  return tail.map((p) => {
    const d = new Date(p.time * 1000)

    // PVE node rrddata: cpu is already a 0-1 ratio (0.15 = 15% of all cores)
    const cpuRaw = Number(p.cpu ?? 0)
    const cpuPct = Math.round(clampPct(cpuRaw * 100) * 10) / 10

    const memUsed = Number(p.mem ?? p.memused ?? 0)
    const memTotal = Number(p.maxmem ?? p.memtotal ?? 0)
    const ramPct = memTotal > 0 ? Math.round(clampPct((memUsed / memTotal) * 100)) : 0

    return { ts: p.time, t: formatTimestamp(d, timeframe), cpu: cpuPct, ram: ramPct }
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  const conn = await getConnectionById(id)

  const body = (await req.json().catch(() => null)) as
    | { items?: { node: string }[]; timeframe?: string }
    | null

  const items = body?.items ?? []
  const timeframe = body?.timeframe ?? "hour"

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ data: {} })
  }

  // Optimisation: charger tous les nodes en parallèle au lieu de séquentiellement
  const results = await Promise.allSettled(
    items.map(async (it) => {
      const node = String(it.node || "")
      const key = `node:${node}`

      try {
        const rrd = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(node)}/rrddata?timeframe=${encodeURIComponent(timeframe)}&cf=AVERAGE`,
          { method: "GET" }
        )

        
return { key, data: toTrendPoints(rrd, timeframe) }
      } catch {
        return { key, data: [] }
      }
    })
  )

  const out: Record<string, any[]> = {}

  for (const result of results) {
    if (result.status === 'fulfilled') {
      out[result.value.key] = result.value.data
    }
  }

  return NextResponse.json({ data: out })
}
