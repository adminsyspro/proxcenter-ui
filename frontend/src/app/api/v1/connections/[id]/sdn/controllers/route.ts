import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { sdnOwnVnets } from "@/lib/vdc/sdnReadScope"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (permError) return permError
    const conn = await getConnectionById(id)
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    // A vDC tenant only reads its own VNets here (roadmap#81).
    if (await sdnOwnVnets(id)) return NextResponse.json({ data: { controllers: [] } })
    const controllers = await pveFetch<any[]>(conn, "/cluster/sdn/controllers")
    return NextResponse.json({ data: { controllers: controllers ?? [] } })
  } catch (e: any) {
    console.error("Error fetching SDN controllers:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
