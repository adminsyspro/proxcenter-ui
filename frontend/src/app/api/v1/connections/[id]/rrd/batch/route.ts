import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getRBACContext, hasPermission } from "@/lib/rbac"
import { resolveRrdScope } from "@/lib/rbac/rrdScope"

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

    const rbac = await getRBACContext()
    if (!rbac) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

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

    const allowed = new Set(["hour", "day", "week", "month", "year"])
    const tf = allowed.has(timeframe) ? timeframe : "hour"

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
