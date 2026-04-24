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

    const res = await pbsFetch<any>(conn, "/nodes/localhost/apt/repositories")

    return NextResponse.json({ data: res })
  } catch (e: any) {
    console.error("PBS repositories GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "pbs", id)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    const op = body?.op

    if (op !== "toggle" && op !== "add") {
      return NextResponse.json(
        { error: "Invalid body: 'op' must be 'toggle' or 'add'" },
        { status: 400 }
      )
    }

    const conn = await getPbsConnectionById(id)

    if (op === "toggle") {
      const { path, index, enabled, digest } = body

      if (typeof path !== "string" || path.length === 0) {
        return NextResponse.json({ error: "Invalid body: 'path' must be a non-empty string" }, { status: 400 })
      }

      if (typeof index !== "number" || !Number.isFinite(index) || index < 0) {
        return NextResponse.json({ error: "Invalid body: 'index' must be a non-negative number" }, { status: 400 })
      }

      if (typeof enabled !== "boolean") {
        return NextResponse.json({ error: "Invalid body: 'enabled' must be a boolean" }, { status: 400 })
      }

      const payload: Record<string, any> = {
        path,
        index,
        enabled: enabled ? 1 : 0,
      }

      if (typeof digest === "string" && digest.length > 0) {
        payload.digest = digest
      }

      await pbsFetch(conn, "/nodes/localhost/apt/repositories", {
        method: "PUT",
        body: JSON.stringify(payload),
      })

      return NextResponse.json({ data: { ok: true } })
    }

    // op === 'add'
    const { handle, digest } = body

    if (typeof handle !== "string" || handle.length === 0) {
      return NextResponse.json({ error: "Invalid body: 'handle' must be a non-empty string" }, { status: 400 })
    }

    const payload: Record<string, any> = { handle }

    if (typeof digest === "string" && digest.length > 0) {
      payload.digest = digest
    }

    await pbsFetch(conn, "/nodes/localhost/apt/repositories", {
      method: "PUT",
      body: JSON.stringify(payload),
    })

    return NextResponse.json({ data: { ok: true } })
  } catch (e: any) {
    console.error("PBS repositories POST error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
