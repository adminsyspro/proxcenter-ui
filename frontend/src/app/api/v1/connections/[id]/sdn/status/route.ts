import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

function hasPending(arr: any[] | undefined): boolean {
  if (!Array.isArray(arr)) return false
  for (const item of arr) {
    if (!item) continue
    if (item.pending) return true
    if (item.pending_changes && Object.keys(item.pending_changes).length > 0) return true
    if (item.state === "new" || item.state === "changed" || item.state === "deleted") return true
  }
  return false
}

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

    const [versionRes, zonesRes, vnetsRes, ipamsRes] = await Promise.allSettled([
      pveFetch<any>(conn, "/version"),
      pveFetch<any[]>(conn, "/cluster/sdn/zones?pending=1"),
      pveFetch<any[]>(conn, "/cluster/sdn/vnets?pending=1"),
      pveFetch<any[]>(conn, "/cluster/sdn/ipams"),
    ])

    const versionRaw = versionRes.status === "fulfilled" ? versionRes.value : {}
    const versionStr: string = versionRaw?.version || versionRaw?.release || "0.0.0"
    const pveMajor = Number.parseInt(String(versionStr).split(".")[0], 10) || 0

    const pending = (zonesRes.status === "fulfilled" && hasPending(zonesRes.value))
                 || (vnetsRes.status === "fulfilled" && hasPending(vnetsRes.value))

    const ipamBackends: string[] = ipamsRes.status === "fulfilled" && Array.isArray(ipamsRes.value)
      ? ipamsRes.value.map((x) => String(x?.ipam || "")).filter(Boolean)
      : []

    return NextResponse.json({
      data: {
        version: { release: versionStr, repoid: versionRaw?.repoid },
        pveMajor,
        pending,
        ipamBackends,
      },
    })
  } catch (e: any) {
    console.error("Error fetching SDN status:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
