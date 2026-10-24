import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, guestPerimeterAllows, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant } from "@/lib/vdc/quota"
import type { QemuMachineVersion } from "@/lib/inventory/qemuMachines"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/machines
// Versioned QEMU machine types the node's QEMU build supports, newest first
// (`pc-q35-10.1`, `pc-i440fx-11.0+pve2`…), so the creation wizard can pin a
// machine version instead of only picking the family (#1194).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // Same gate as cpu-models: flat-scoped callers (vm/tag/pool) match no
    // node resource but still open the creation wizard.
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied && !(await guestPerimeterAllows(id, PERMISSIONS.NODE_VIEW))) return denied

    try {
      await resolveVdcForTenant(await getCurrentTenantId(), id, node)
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }
      throw e
    }

    const conn = await getConnectionById(id)
    const raw = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/capabilities/qemu/machines`
    )

    const data: QemuMachineVersion[] = (Array.isArray(raw) ? raw : [])
      .filter(m => typeof m?.id === 'string' && (m.type === 'i440fx' || m.type === 'q35'))
      .map(m => ({
        id: m.id,
        type: m.type,
        version: typeof m.version === 'string' && m.version ? m.version : m.id,
        changes: typeof m.changes === 'string' && m.changes ? m.changes : null,
      }))

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
