import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/:id/rrd/batch
 * Body: { paths: ["/nodes/pve1", "/nodes/pve2", ...], timeframe: "hour" }
 * -> Fetches RRD data for all paths in parallel via Proxmox API
 * Returns: { data: { "/nodes/pve1": [...], "/nodes/pve2": [...] } }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  try {
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    const body = await req.json()
    const paths: string[] = body.paths || []
    const timeframe: string = body.timeframe || "hour"

    if (paths.length === 0) {
      return NextResponse.json({ data: {} })
    }

    // Cap at 50 paths to prevent abuse
    if (paths.length > 50) {
      return NextResponse.json({ error: "Too many paths (max 50)" }, { status: 400 })
    }

    const allowed = new Set(["hour", "day", "week", "month", "year"])
    const tf = allowed.has(timeframe) ? timeframe : "hour"

    const conn = await getConnectionById(id)

    // Fetch all RRD data in parallel
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        if (!path.startsWith("/nodes/")) {
          return { path, data: null, error: "Invalid path" }
        }
        const rrdPath = `${path.replace(/\/$/, "")}/rrddata?timeframe=${encodeURIComponent(tf)}&cf=AVERAGE`
        const data = await pveFetch<any[]>(conn, rrdPath)
        return { path, data }
      })
    )

    // Build response map
    const dataMap: Record<string, any[]> = {}
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        dataMap[result.value.path] = result.value.data
      }
    }

    return NextResponse.json({ data: dataMap })

  } catch (e: any) {
    console.error(`[rrd-batch] ERROR connId=${id}:`, e?.message || e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
