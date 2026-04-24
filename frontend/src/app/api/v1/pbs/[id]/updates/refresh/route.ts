import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const upid = await pbsFetch<string>(conn, "/nodes/localhost/apt/update", {
      method: "POST",
      body: JSON.stringify({ notify: 0, quiet: 1 }),
    })

    return NextResponse.json({ data: { upid } })
  } catch (e: any) {
    console.error("PBS updates refresh error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
