import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const url = new URL(req.url)
    const sp = url.searchParams

    const rawLimit = parseInt(sp.get("limit") || "50", 10)
    const limit = Math.max(1, Math.min(500, isNaN(rawLimit) ? 50 : rawLimit))

    const rawStart = parseInt(sp.get("start") || "0", 10)
    const start = Math.max(0, isNaN(rawStart) ? 0 : rawStart)

    const running = sp.get("running") ?? "1"
    const errors = sp.get("errors") ?? "0"
    const userfilter = sp.get("userfilter") || ""
    const typefilter = sp.get("typefilter") || ""
    const since = sp.get("since") || ""
    const until = sp.get("until") || ""

    const qs = new URLSearchParams({
      limit: String(limit),
      start: String(start),
    })

    if (running === "1") qs.set("running", "1")
    if (errors === "1") qs.set("errors", "1")
    if (userfilter) qs.set("userfilter", userfilter)
    if (typefilter) qs.set("typefilter", typefilter)
    if (since) qs.set("since", since)
    if (until) qs.set("until", until)

    const tasks = await pbsFetch<any[]>(conn, `/nodes/localhost/tasks?${qs.toString()}`)

    const data = Array.isArray(tasks) ? tasks : []

    return NextResponse.json({ data, total: data.length })
  } catch (e: any) {
    console.error("PBS tasks error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
