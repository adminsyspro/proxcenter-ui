import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { resizeDiskSchema } from "@/lib/schemas"
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { resolveVdcForTenant, checkVdcQuota } from '@/lib/vdc/quota'
import { parseDriveString } from '@/lib/vdc/drives'

export const runtime = "nodejs"

function parseSizeDeltaMb(size: string): number {
  const match = size.match(/^\+?(\d+(?:\.\d+)?)\s*(G|M|T|K)?/i)
  if (!match) return 0
  const value = Number.parseFloat(match[1])
  const unit = (match[2] || 'G').toUpperCase()
  if (unit === 'T') return Math.round(value * 1024 * 1024)
  if (unit === 'G') return Math.round(value * 1024)
  if (unit === 'K') return Math.round(value / 1024)
  return Math.round(value) // MB
}

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/disk/resize
// Redimensionne un disque (agrandissement uniquement)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    // RBAC: Check vm.config permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG, "vm", resourceId)

    if (denied) return denied

    const rawBody = await req.json()
    const parseResult = resizeDiskSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { disk, size } = parseResult.data

    const conn = await getConnectionById(id)

    const tenantId = await getCurrentTenantId()
    try {
      const vdcInfo = await resolveVdcForTenant(tenantId, id, node)

      if (vdcInfo) {
        // Storage-tier scope (spec §6): a disk living on a storage that has
        // since dropped out of the tenant's vDC scope is refused outright,
        // independent of the requested delta.
        const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
        let diskStorage: string | null = null
        if (infra.kind === 'iaas') {
          const scope = infra.vdcScope
          const resourceTypePve = type === 'lxc' ? 'lxc' : 'qemu'
          const cfg = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/${resourceTypePve}/${encodeURIComponent(vmid)}/config`)
          const parsed = parseDriveString(String(cfg?.[disk] ?? ''))
          diskStorage = parsed.ok === false ? null : parsed.drive.storage
          const allowed = scope?.storagesByConnection.get(id) ?? new Set<string>()
          if (diskStorage && !allowed.has(diskStorage)) {
            return NextResponse.json(
              { error: `Storage "${diskStorage}" is not authorised for this tenant.` }, { status: 403 })
          }
        }

        const deltaMb = parseSizeDeltaMb(size)

        if (deltaMb > 0) {
          const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
            type: 'resize',
            addStorageMb: deltaMb,
            addVms: 0,
            addStorageMbByStorage: diskStorage ? { [diskStorage]: deltaMb } : undefined,
          }, vdcInfo.storagePolicies, node)

          if (!quotaCheck.allowed) {
            return NextResponse.json({
              error: 'Quota exceeded',
              violations: quotaCheck.violations,
            }, { status: 409 })
          }
        }
      }
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }
      throw e
    }

    // Déterminer le type de ressource pour l'API Proxmox
    const resourceType = type === 'lxc' ? 'lxc' : 'qemu'
    
    // Construire les paramètres
    const resizeParams: Record<string, any> = {
      disk,
      size,
    }
    
    // Appeler l'API Proxmox
    const endpoint = resourceType === 'qemu' 
      ? `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/resize`
      : `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/resize`
    
    const result = await pveFetch<string>(
      conn,
      endpoint,
      {
        method: 'PUT',
        body: new URLSearchParams(
          Object.entries(resizeParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: id, disk, size },
    })

    return NextResponse.json({
      success: true,
      data: result,
      message: `Disque ${disk} redimensionné de ${size}`
    })
  } catch (e: any) {
    console.error('Error resizing disk:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
