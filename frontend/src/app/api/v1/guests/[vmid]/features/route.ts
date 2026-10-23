import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionByIdOrNull } from "@/lib/connections/getConnection"
import { safeLog } from "@/lib/log/sanitize"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { guardSessionGuest, parseGuestKey } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

/**
 * GET /api/v1/guests/[vmid]/features?feature=snapshot
 * Check if a feature is available for a LXC container
 * Only applicable to LXC (VMs always support snapshots)
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const key = parseGuestKey(params.vmid)
    if (!key.ok) return key.response
    const { connId, type, node, vmid } = key

    // RBAC: vm.view, checked first, before the constant-answer shortcut
    // below, so this route cannot be used as an unauthenticated oracle either.
    const denied = await checkPermission(
      PERMISSIONS.VM_VIEW,
      "vm",
      buildVmResourceId(connId, node, type, vmid)
    )

    if (denied) return denied

    const url = new URL(req.url)
    const feature = url.searchParams.get('feature')

    if (!feature) {
      return NextResponse.json({ error: "feature query param is required" }, { status: 400 })
    }

    // VMs (qemu) always support snapshots
    if (type !== 'lxc') {
      return NextResponse.json({ data: { hasFeature: true } })
    }

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // The qemu shortcut above answers a constant, so only this PVE read is confined.
    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    const apiPath = `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/feature`
    const result = await pveFetch<any>(conn, `${apiPath}?feature=${encodeURIComponent(feature)}`)

    return NextResponse.json({
      data: { hasFeature: !!result?.hasFeature }
    })
  } catch (e: any) {
    console.error("Feature check error:", safeLog(e?.message))
    return NextResponse.json({ error: e?.message || "Feature check failed" }, { status: 500 })
  }
}
