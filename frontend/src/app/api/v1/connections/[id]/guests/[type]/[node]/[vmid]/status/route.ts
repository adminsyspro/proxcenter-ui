import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { isVmConfigNotFoundError, locateVmInCluster, type GuestType } from "@/lib/proxmox/locateVm"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; type: string; node: string; vmid: string }>
}

/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/status
 *
 * Récupère le status actuel d'une VM (running, stopped, paused, etc.)
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Resolve via the original node first; on "config does not exist"
    // (typical post-intra-cluster-migration when callers still hold a
    // stale node), look the VM up in /cluster/resources and retry on
    // its current node. Surfaces movedTo so the frontend can update its
    // node reference and stop polling the stale URL.
    let resolvedNode = node
    let movedTo: string | null = null
    let statusData: any

    try {
      statusData = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/status/current`
      )
    } catch (err: any) {
      if (!isVmConfigNotFoundError(err)) throw err
      const located = await locateVmInCluster(conn, vmid, type as GuestType)

      if (!located || located.node === node) throw err
      resolvedNode = located.node
      movedTo = located.node
      statusData = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(resolvedNode)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/status/current`
      )
    }

    return NextResponse.json({
      data: {
        status: statusData?.status || 'unknown',
        name: statusData?.name,
        uptime: statusData?.uptime,
        cpu: statusData?.cpu,
        mem: statusData?.mem,
        maxmem: statusData?.maxmem,
        disk: statusData?.disk,
        maxdisk: statusData?.maxdisk,
      },
      movedTo,
    })
  } catch (e: any) {
    console.error("[guest/status] Error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
