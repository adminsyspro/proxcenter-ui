import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, guestPerimeterAllows, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant } from "@/lib/vdc/quota"
import { resolveAllowedCpuModels, normalizeCpuModelName } from "@/lib/vdc/computePolicy"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/cpu-models
// Liste les modèles CPU QEMU disponibles sur un node (builtin + modèles custom
// du cluster définis dans /etc/pve/virtual-guest/cpu-models.conf).
//
// For a tenant whose vDC carries a compute policy (#893), the list is
// narrowed to the allowed models and the policy itself is returned so the
// CPU pickers can hide the advanced controls and pre-select the default.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // Flat-scoped callers (vm/tag/pool) match no node resource, which used to
    // 403 the CPU tab of the creation wizard (issue #262).
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied && !(await guestPerimeterAllows(id, PERMISSIONS.NODE_VIEW))) return denied

    const conn = await getConnectionById(id)

    const raw = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/capabilities/qemu/cpu`
    )
    let models: any[] = Array.isArray(raw) ? raw : []

    const tenantId = await getCurrentTenantId()
    let vdcInfo: Awaited<ReturnType<typeof resolveVdcForTenant>> = null
    try {
      vdcInfo = await resolveVdcForTenant(tenantId, id, node)
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }
      throw e
    }

    let policy: {
      cpuModelMode: string
      cpuAdvancedSettings: boolean
      cpuDefaultModel: string | null
      allowedModels: string[] | null
    } | null = null

    if (vdcInfo) {
      const cp = vdcInfo.computePolicy
      const allowed = resolveAllowedCpuModels(cp, models)
      if (allowed) {
        models = models.filter(m => {
          const name = normalizeCpuModelName(m)
          return name !== null && allowed.has(name)
        })
      }
      policy = {
        cpuModelMode: cp.cpuModelMode,
        cpuAdvancedSettings: cp.cpuAdvancedSettings,
        cpuDefaultModel: cp.cpuDefaultModel,
        allowedModels: allowed ? [...allowed].sort((a, b) => a.localeCompare(b)) : null,
      }
    }

    return NextResponse.json({ data: models, policy })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
