import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { pendingChangesFromPve } from "@/lib/migration/pendingChanges"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/migrate/pending-check
// Configuration changes the guest has not applied yet (#926), so the migrate
// dialogs can warn that PVE may refuse to move it before it is restarted.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    let safeVmid: string
    let safeNode: string
    try {
      safeVmid = assertVmid(vmid)
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", buildVmResourceId(id, safeNode, type, safeVmid))
    if (denied) return denied

    const conn = await getConnectionById(id)
    const guestType = type === 'lxc' ? 'lxc' : 'qemu'
    const rows = await pveFetch<unknown>(conn, `/nodes/${encodeURIComponent(safeNode)}/${guestType}/${encodeURIComponent(safeVmid)}/pending`)

    return NextResponse.json({ data: { changes: pendingChangesFromPve(rows) } })
  } catch (e: any) {
    console.error('[migrate/pending-check] GET error:', String(e?.message || e).replace(/[\r\n]/g, ''))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
