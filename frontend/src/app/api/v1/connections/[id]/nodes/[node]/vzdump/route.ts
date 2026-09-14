import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { writableStoragesFor, readOnlyLibraryError } from "@/lib/vdc/scope"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/nodes/{node}/vzdump
// Lance une sauvegarde de VM/CT
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check backup permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.VM_BACKUP, "node", resourceId)

    if (denied) return denied

    const body = await req.json()
    const { vmid, storage, mode = 'snapshot', compress = 'zstd', notes } = body

    if (!vmid) {
      return NextResponse.json({ error: "VMID is required" }, { status: 400 })
    }

    if (!storage) {
      return NextResponse.json({ error: "Storage is required" }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    if (tenantId && tenantId !== DEFAULT_TENANT_ID) {
      const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
      if (infra.kind === 'iaas' && infra.vdcScope) {
        // A backup is a write: a read-only ISO library (#894) is visible to
        // the tenant but never a valid destination.
        const allowed = writableStoragesFor(infra.vdcScope, id)
        if (!allowed.has(storage)) {
          const visible = infra.vdcScope.storagesByConnection.get(id)?.has(storage)
          return NextResponse.json(
            { error: visible ? readOnlyLibraryError(storage) : `Storage "${storage}" is not authorised for this tenant.` },
            { status: 403 },
          )
        }
      }
    }

    const conn = await getConnectionById(id)
    
    // Construire les paramètres pour vzdump
    const vzdumpParams: Record<string, any> = {
      vmid: vmid,
      storage: storage,
      mode: mode,
      compress: compress,
    }
    
    if (notes) {
      // PVE rejects the bare `notes` key with "property is not defined in
      // schema". The vzdump endpoint takes `notes-template`, a string that
      // PVE expands (placeholders like {{guestname}}, {{node}}) and attaches
      // to the resulting backup as a free-form note. We pass the user's text
      // verbatim — no placeholders means PVE just stores it as-is.
      vzdumpParams['notes-template'] = notes
    }
    
    // Appeler l'API Proxmox vzdump
    const result = await pveFetch<string>(
      conn,
      `/nodes/${encodeURIComponent(node)}/vzdump`,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(vzdumpParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "backup",
      category: "backups",
      resourceType: "vm",
      resourceId: String(vmid),
      details: { node, connectionId: id, storage, mode },
    })

    return NextResponse.json({
      success: true,
      data: result,
      message: `Sauvegarde de VM ${vmid} lancée`
    })
  } catch (e: any) {
    console.error('Error creating backup:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
