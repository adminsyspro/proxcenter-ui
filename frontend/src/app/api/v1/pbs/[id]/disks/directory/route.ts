import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

function isNotSupported(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes("404") ||
    m.includes("501") ||
    m.includes("not implemented") ||
    m.includes("no such") ||
    m.includes("not found")
  )
}

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

    try {
      const dirs = await pbsFetch<any[]>(conn, "/nodes/localhost/disks/directory")

      return NextResponse.json({ data: Array.isArray(dirs) ? dirs : [] })
    } catch (inner: any) {
      if (isNotSupported(String(inner?.message || inner))) {
        return NextResponse.json({ data: [] })
      }
      throw inner
    }
  } catch (e: any) {
    console.error("PBS disks/directory GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
