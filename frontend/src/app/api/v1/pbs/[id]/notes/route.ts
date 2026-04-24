import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

function isForbidden(msg: string): boolean {
  return /\bPBS 403\b|permission|privilege/i.test(msg)
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
      const cfg = await pbsFetch<any>(conn, "/nodes/localhost/config")
      const notes = typeof cfg?.description === "string" ? cfg.description : ""

      return NextResponse.json({ data: { notes } })
    } catch (e: any) {
      const msg = e?.message || String(e)

      if (isForbidden(msg)) {
        return NextResponse.json(
          { error: msg, forbidden: true, requiredPriv: "Sys.Audit on /" },
          { status: 403 }
        )
      }
      throw e
    }
  } catch (e: any) {
    console.error("PBS notes GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    const notes = body?.notes

    if (typeof notes !== "string") {
      return NextResponse.json({ error: "Invalid body: 'notes' must be a string" }, { status: 400 })
    }

    const conn = await getPbsConnectionById(id)

    try {
      await pbsFetch(conn, "/nodes/localhost/config", {
        method: "PUT",
        body: JSON.stringify({ description: notes }),
      })

      return NextResponse.json({ data: { ok: true } })
    } catch (e: any) {
      const msg = e?.message || String(e)

      if (isForbidden(msg)) {
        return NextResponse.json(
          { error: msg, forbidden: true, requiredPriv: "Sys.Modify on /" },
          { status: 403 }
        )
      }
      throw e
    }
  } catch (e: any) {
    console.error("PBS notes PUT error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
