import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { sdnOwnVnets } from "@/lib/vdc/sdnReadScope"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; vnet: string }> }
) {
  try {
    const { id, vnet } = await ctx.params
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (permError) return permError
    const conn = await getConnectionById(id)
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    // Another tenant's VNet answers like a missing one (roadmap#81).
    const own = await sdnOwnVnets(id)
    if (own && !own.has(vnet)) return NextResponse.json({ error: "VNet not found" }, { status: 404 })
    const rules = await pveFetch<any[]>(
      conn,
      `/cluster/sdn/vnets/${encodeURIComponent(vnet)}/firewall/rules`
    )
    return NextResponse.json({ data: { rules: rules ?? [] } })
  } catch (e: any) {
    console.error("Error fetching VNet firewall rules:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
