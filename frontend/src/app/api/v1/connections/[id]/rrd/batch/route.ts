import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getRBACContext, hasPermission } from "@/lib/rbac"
import { resolveRrdScope } from "@/lib/rbac/rrdScope"
import { applyRrdWindow, presetRangeMeta, resolveRrdRequest } from "@/lib/metrics/rrdRange"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/:id/rrd/batch
 * Body: { paths: ["/nodes/pve1", "/nodes/pve2", ...], timeframe: "hour" }
 *       or { paths: [...], from: <epoch s>, to: <epoch s> } for a custom window
 * -> Fetches RRD data for all paths in parallel via Proxmox API
 * Returns: { data: { "/nodes/pve1": [...], "/nodes/pve2": [...] }, meta }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  try {
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const rbac = await getRBACContext()
    if (!rbac) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await req.json()
    const paths: string[] = body.paths || []
    const timeframe: string = body.timeframe || "hour"

    // One window for the whole batch: every path is clipped identically, so
    // the caller's charts stay on the same axis.
    const { timeframe: tf, window, truncated } = resolveRrdRequest(timeframe, body.from, body.to)

    if (paths.length === 0) {
      return NextResponse.json({ data: {} })
    }

    // Cap at 50 paths to prevent abuse
    if (paths.length > 50) {
      return NextResponse.json({ error: "Too many paths (max 50)" }, { status: 400 })
    }

    // Gate each path on the resource it addresses (node.view for a node path,
    // vm.view for a VM path). Paths the caller can't see are dropped from the
    // batch rather than failing the whole request, so a scoped user still gets
    // graphs for the nodes they can see. See resolveRrdScope (issue #378).
    const allowedPaths = (
      await Promise.all(
        paths.map(async (path) => {
          const scope = resolveRrdScope(id, path)
          if (!scope) return null
          const ok = await hasPermission({
            userId: rbac.userId,
            permission: scope.permission,
            resourceType: scope.resourceType,
            resourceId: scope.resourceId,
            tenantId: rbac.tenantId,
          })
          return ok ? path : null
        }),
      )
    ).filter((p): p is string => p !== null)

    if (allowedPaths.length === 0) {
      return NextResponse.json({ data: {} })
    }

    const conn = await getConnectionById(id)

    // Fetch all RRD data in parallel
    const results = await Promise.allSettled(
      allowedPaths.map(async (path) => {
        const rrdPath = `${path.replace(/\/$/, "")}/rrddata?timeframe=${encodeURIComponent(tf)}&cf=AVERAGE`
        const data = await pveFetch<any[]>(conn, rrdPath)
        return { path, data }
      })
    )

    // Build response map
    const dataMap: Record<string, any[]> = {}
    let meta = null

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        const rows = result.value.data

        if (!window) {
          dataMap[result.value.path] = rows
          meta = meta ?? presetRangeMeta(rows, tf)
        } else {
          const clipped = applyRrdWindow(rows, window, tf, truncated)

          dataMap[result.value.path] = clipped.rows
          meta = meta ?? clipped.meta
        }
      }
    }

    return NextResponse.json({ data: dataMap, meta })

  } catch (e: any) {
    console.error(`[rrd-batch] ERROR connId=${id}:`, e?.message || e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
