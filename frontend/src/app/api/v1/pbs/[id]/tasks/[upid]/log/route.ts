import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; upid: string }> | { id: string; upid: string } }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const upid = (params as any)?.upid

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    if (!upid) return NextResponse.json({ error: "Missing params.upid" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const url = new URL(req.url)
    const sp = url.searchParams

    const rawLimit = parseInt(sp.get("limit") || "500", 10)
    const limit = Math.max(1, Math.min(5000, isNaN(rawLimit) ? 500 : rawLimit))

    const rawStart = parseInt(sp.get("start") || "0", 10)
    const start = Math.max(0, isNaN(rawStart) ? 0 : rawStart)

    const encodedUpid = encodeURIComponent(upid)

    const [log, status] = await Promise.all([
      pbsFetch<Array<{ n: number; t: string }>>(
        conn,
        `/nodes/localhost/tasks/${encodedUpid}/log?start=${start}&limit=${limit}`
      ).catch((e: any) => {
        console.error("PBS task log fetch error:", e)
        return [] as Array<{ n: number; t: string }>
      }),
      pbsFetch<any>(conn, `/nodes/localhost/tasks/${encodedUpid}/status`).catch((e: any) => {
        console.error("PBS task status fetch error:", e)
        return null
      }),
    ])

    return NextResponse.json({
      data: {
        log: Array.isArray(log) ? log : [],
        status: status || null,
      },
    })
  } catch (e: any) {
    console.error("PBS task log error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
