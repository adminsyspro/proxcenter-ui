import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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

    try {
      // PVE 9+: /cluster/sdn/fabrics returns { fabrics, nodes } (exact shape may evolve).
      const payload = await pveFetch<any>(conn, "/cluster/sdn/fabrics")
      // Normalise to { fabrics, nodes } regardless of the PVE response shape variations.
      const rawFabrics = Array.isArray(payload) ? payload : (payload?.fabrics ?? [])
      // PVE directory-index endpoints can return self-descriptors like [{"subdir":"fabric"}].
      // Keep only entries that look like real fabric records (have a `fabric` id).
      const fabrics = rawFabrics.filter((f: any) => f && typeof f === "object" && typeof f.fabric === "string")
      const nodes = Array.isArray(payload) ? [] : (payload?.nodes ?? [])
      return NextResponse.json({ data: { fabrics, nodes } })
    } catch (e: any) {
      // pveFetch throws with message "PVE 404 ...". On PVE 8 the endpoint does not exist.
      const msg = String(e?.message || "")
      if (/PVE\s+404\b/.test(msg)) {
        return NextResponse.json({ data: { unavailable: true, reason: "pve-version" } })
      }
      throw e
    }
  } catch (e: any) {
    console.error("Error fetching SDN fabrics:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
