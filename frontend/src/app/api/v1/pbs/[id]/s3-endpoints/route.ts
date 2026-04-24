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

    try {
      const endpoints = await pbsFetch<any[]>(conn, "/config/s3-endpoint")

      return NextResponse.json({ data: Array.isArray(endpoints) ? endpoints : [] })
    } catch (inner: any) {
      const msg = String(inner?.message || inner || "")

      // PBS < 4 does not support S3 endpoints — treat 404 / 501 as notSupported
      if (/\bPBS\s+(404|501)\b/.test(msg) || /not\s+implemented/i.test(msg) || /no such/i.test(msg)) {
        return NextResponse.json({ data: [], notSupported: true })
      }

      throw inner
    }
  } catch (e: any) {
    console.error("PBS s3-endpoints GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
