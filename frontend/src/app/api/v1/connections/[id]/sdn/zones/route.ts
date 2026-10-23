import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { keepOwnVnets, keepZonesOf, sdnOwnVnets } from "@/lib/vdc/sdnReadScope"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/sdn/zones
// Returns SDN zones (pending=1 so callers see both applied and staged state).
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

    const zones = (await pveFetch<any[]>(conn, "/cluster/sdn/zones?pending=1")) ?? []

    // A vDC tenant only sees the zones that hold its own VNets (roadmap#81).
    const own = await sdnOwnVnets(id)
    if (!own) return NextResponse.json({ data: { zones } })
    const vnets = keepOwnVnets((await pveFetch<any[]>(conn, "/cluster/sdn/vnets?pending=1")) ?? [], own)
    return NextResponse.json({ data: { zones: keepZonesOf(zones, vnets) } })
  } catch (e: any) {
    console.error("Error fetching SDN zones:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
