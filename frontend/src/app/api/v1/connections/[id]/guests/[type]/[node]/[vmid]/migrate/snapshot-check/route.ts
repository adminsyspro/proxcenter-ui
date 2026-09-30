import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkSnapshotMigration } from "@/lib/migration/snapshotMigrationCheck"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/migrate/snapshot-check?target=pve2[&targetstorage=x]
// Local volumes that snapshots stop from migrating to another node of the
// same cluster (#1027), for a live and for an offline migration, so the
// dialog can explain and offer a remedy before PVE aborts the task.
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

    const conn = await getConnectionById(id)
    const data = await checkSnapshotMigration(
      conn,
      { node: safeNode, type: type === 'lxc' ? 'lxc' : 'qemu', vmid: safeVmid },
      { target: safeTarget, targetStorage },
    )

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error('[migrate/snapshot-check] GET error:', String(e?.message || e).replace(/[\r\n]/g, ''))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
