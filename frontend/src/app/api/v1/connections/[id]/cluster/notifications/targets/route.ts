import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET - List all notification targets (endpoints)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    const conn = await getConnectionById(id)

    // PVE returns endpoint types at /cluster/notifications/endpoints
    // We need to fetch each type's actual endpoints
    const types = await pveFetch<any[]>(conn, "/cluster/notifications/endpoints")
    const allTargets: any[] = []

    if (Array.isArray(types)) {
      const results = await Promise.all(
        types.map(async (t: any) => {
          const typeName = typeof t === 'string' ? t : t?.name || t?.type
          if (!typeName) return []
          try {
            const endpoints = await pveFetch<any[]>(conn, `/cluster/notifications/endpoints/${typeName}`)
            return (endpoints || []).map((ep: any) => ({ ...ep, type: typeName }))
          } catch {
            return []
          }
        })
      )
      for (const r of results) allTargets.push(...r)
    }

    return NextResponse.json({ data: allTargets })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
