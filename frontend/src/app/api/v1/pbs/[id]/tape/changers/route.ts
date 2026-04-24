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

    const paths = ["/tape/changer", "/config/changer"]
    let lastError: any = null

    for (const path of paths) {
      try {
        const changers = await pbsFetch<any[]>(conn, path)

        return NextResponse.json({ data: Array.isArray(changers) ? changers : [] })
      } catch (inner: any) {
        lastError = inner
        if (!isNotSupported(String(inner?.message || inner))) {
          throw inner
        }
      }
    }

    if (lastError && isNotSupported(String(lastError?.message || lastError))) {
      return NextResponse.json({ data: [], notSupported: true })
    }

    return NextResponse.json({ data: [], notSupported: true })
  } catch (e: any) {
    console.error("PBS tape/changers GET error:", e)
    if (isNotSupported(String(e?.message || e))) {
      return NextResponse.json({ data: [], notSupported: true })
    }

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
