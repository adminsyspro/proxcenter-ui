import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission } from "@/lib/rbac"
import { resolveRrdScope } from "@/lib/rbac/rrdScope"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/:id/rrd?path=/nodes/<node>[/qemu/<vmid>|/lxc/<vmid>]&timeframe=hour|day|week|month|year
 * -> proxy vers Proxmox: <path>/rrddata?timeframe=...&cf=AVERAGE
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  const url = new URL(req.url)
  const path = url.searchParams.get("path") || ""
  const timeframe = url.searchParams.get("timeframe") || "hour"

  try {
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // Gate on the resource the path actually addresses (vm.view for a VM path,
    // node.view for a node/storage path) so VM- and node-scoped users can read
    // the Performance graphs of resources they already see in the inventory.
    // A connection-scoped check would 403 them (see resolveRrdScope).
    const scope = resolveRrdScope(id, path)
    if (!scope) {
      return NextResponse.json({ error: "Invalid path (must start with /nodes/)" }, { status: 400 })
    }

    const denied = await checkPermission(scope.permission, scope.resourceType, scope.resourceId)
    if (denied) return denied

    const allowed = new Set(["hour", "day", "week", "month", "year"])
    const tf = allowed.has(timeframe) ? timeframe : "hour"

    const conn = await getConnectionById(id)
    const rrdPath = `${path.replace(/\/$/, "")}/rrddata?timeframe=${encodeURIComponent(tf)}&cf=AVERAGE`

    const data = await pveFetch<any[]>(conn, rrdPath)

    return NextResponse.json({ data })

  } catch (e: any) {
    console.error(`[rrd-api] ERROR connId=${id} path=${path} tf=${timeframe}:`, e?.message || e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
