import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkTargetStorage } from "@/lib/migration/targetStorageCheck"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { migrationTenantDenied } from "@/lib/tenant/migrationGuard"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"
import { guardSessionGuest } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/migrate/storage-check?target=pve2[&targetstorage=x]
// What PVE will do with the target storage picked for a migration inside the
// cluster (#1402): apply it, or drop it without a word for an HA-managed guest
// and for replicated volumes. The dialog then moves the disks first, or says
// why the storage cannot be honoured.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params
    const params = new URL(req.url).searchParams
    const target = params.get('target') || ''
    const targetStorage = params.get('targetstorage') || undefined

    let safeVmid: string
    let safeNode: string
    let safeTarget: string
    try {
      safeVmid = assertVmid(vmid)
      safeNode = assertNodeName(node)
      safeTarget = assertNodeName(target)
    } catch {
      return NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", buildVmResourceId(id, safeNode, type, safeVmid))
    if (denied) return denied

    const tenantDenied = await migrationTenantDenied(id)
    if (tenantDenied) return tenantDenied

    const conn = await getConnectionById(id)

    const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type, node: safeNode, vmid: safeVmid })
    if (scopeDenied) return scopeDenied

    const data = await checkTargetStorage(
      conn,
      { node: safeNode, type: type === 'lxc' ? 'lxc' : 'qemu', vmid: safeVmid },
      { target: safeTarget, targetStorage },
    )

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error('[migrate/storage-check] GET error:', String(e?.message || e).replace(/[\r\n]/g, ''))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
