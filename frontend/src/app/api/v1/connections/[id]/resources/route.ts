// src/app/api/v1/connections/[id]/resources/route.ts
import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { mapClusterResource } from "@/lib/proxmox/mappers"
import { getRBACContext, filterVmsByPermission, PERMISSIONS, checkPermission } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Use VM_VIEW without resource context so scoped users (node/vm/tag/pool) pass.
    // The actual filtering happens below with filterVmsByPermission.
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const raw = await pveFetch<any[]>(conn, "/cluster/resources")

    // Filtrer uniquement les VMs/CTs (pas les nodes, storage, etc.)
    let guests = raw
      .filter((r) => r?.type === "qemu" || r?.type === "lxc")
      .map(mapClusterResource)

    // Apply RBAC scope filtering so scoped users only see their permitted VMs
    const rbacCtx = await getRBACContext()
    if (rbacCtx && !rbacCtx.isAdmin) {
      const withMeta = guests.map(g => ({
        ...g,
        connId: id,
        vmid: String(g.vmid),
      }))
      const filtered = filterVmsByPermission(
        rbacCtx.userId,
        withMeta,
        PERMISSIONS.VM_VIEW,
        rbacCtx.tenantId
      )
      const allowed = new Set(filtered.map(g => g.vmid))
      guests = guests.filter(g => allowed.has(String(g.vmid)))
    }

    return NextResponse.json({ data: guests })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
