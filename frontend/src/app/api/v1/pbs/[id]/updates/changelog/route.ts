import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const url = new URL(req.url)
    const name = (url.searchParams.get("name") || "").trim()
    const version = (url.searchParams.get("version") || "").trim()

    if (!name) return NextResponse.json({ error: "Missing 'name' query param" }, { status: 400 })
    if (!version) return NextResponse.json({ error: "Missing 'version' query param" }, { status: 400 })

    const conn = await getPbsConnectionById(id)

    try {
      const changelog = await pbsFetch<string>(
        conn,
        `/nodes/localhost/apt/changelog?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`
      )

      return NextResponse.json({ data: { changelog: typeof changelog === "string" ? changelog : "" } })
    } catch (e: any) {
      const msg = e?.message || String(e)

      if (/\bPBS 403\b|permission|privilege/i.test(msg)) {
        return NextResponse.json(
          {
            error: msg,
            forbidden: true,
            requiredPriv: "Sys.Modify on /system (for the PBS API token)",
          },
          { status: 403 }
        )
      }
      throw e
    }
  } catch (e: any) {
    console.error("PBS updates changelog error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
