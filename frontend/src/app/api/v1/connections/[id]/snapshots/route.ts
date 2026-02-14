import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/snapshots?node=xxx
 * Aggregates snapshots from all VMs/CTs in a cluster (or filtered by node).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const conn = await getConnectionById(id)

    const url = new URL(req.url)
    const nodeFilter = url.searchParams.get('node')

    // 1. Get all VMs/CTs via cluster resources
    const resources = await pveFetch<any[]>(conn, "/cluster/resources")
    let guests = (resources || []).filter(
      (r) => r?.type === "qemu" || r?.type === "lxc"
    )

    if (nodeFilter) {
      guests = guests.filter((g) => g.node === nodeFilter)
    }

    // 2. Fetch snapshots in parallel for each guest
    const results = await Promise.allSettled(
      guests.map(async (guest) => {
        const apiPath = `/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}/snapshot`
        try {
          const snaps = await pveFetch<any[]>(conn, apiPath)
          return (snaps || [])
            .filter((s) => s.name !== "current")
            .map((s) => ({
              vmid: guest.vmid,
              vmName: guest.name || `${guest.type}/${guest.vmid}`,
              vmType: guest.type as "qemu" | "lxc",
              vmStatus: guest.status || "unknown",
              node: guest.node,
              name: s.name,
              description: s.description || "",
              snaptime: s.snaptime || 0,
              vmstate: !!s.vmstate,
              parent: s.parent || null,
            }))
        } catch {
          return []
        }
      })
    )

    const snapshots = results
      .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
      .flatMap((r) => r.value)
      .sort((a, b) => b.snaptime - a.snaptime)

    const vmIdsWithSnaps = new Set(snapshots.map((s) => `${s.vmType}/${s.vmid}`))

    return NextResponse.json({
      data: {
        snapshots,
        totalCount: snapshots.length,
        vmCount: vmIdsWithSnaps.size,
      },
    })
  } catch (e: any) {
    console.error("Bulk snapshots error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
