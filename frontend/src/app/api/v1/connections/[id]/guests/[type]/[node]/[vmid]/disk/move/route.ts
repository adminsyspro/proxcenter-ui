import { NextResponse, after } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { moveDiskSchema } from "@/lib/schemas"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { parseDriveString, parsePveSizeToMb, stampDriveQos, type DriveQosCaps } from "@/lib/vdc/drives"
import { waitForTask } from "@/lib/proxmox/tasks"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/disk/move
// Déplace un disque vers un autre stockage
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
    const parseResult = moveDiskSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { disk, storage, deleteSource, format } = parseResult.data

    const conn = await getConnectionById(id)
    const resourceTypePve = type === 'lxc' ? 'lxc' : 'qemu'

    // vDC guard (spec §5.3 / §6): target storage must be in scope, the node
    // must be authorised for the tenant's vDC, and a move onto a policied
    // storage is metered against that tier's quota. Provider tenants take
    // none of this (infra.kind stays "provider", the block below is a no-op).
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
    let stampCaps: DriveQosCaps | undefined
    if (infra.kind === 'iaas') {
      const scope = infra.vdcScope
      if (!scope) return NextResponse.json({ error: 'Tenant vDC scope not resolved' }, { status: 403 })
      const allowed = scope.storagesByConnection.get(id) ?? new Set<string>()
      if (!allowed.has(storage)) {
        return NextResponse.json(
          { error: `Storage "${storage}" is not authorised for this tenant.` }, { status: 403 })
      }
      let vdcInfo
      try {
        vdcInfo = await resolveVdcForTenant(tenantId, id, node)
      } catch (e: any) {
        if (e?.message === 'NODE_NOT_AUTHORIZED') {
          return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
        }
        throw e
      }
      // Size of the moved disk, read from the live config's size= option.
      const cfg = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/${resourceTypePve}/${encodeURIComponent(vmid)}/config`)
      const parsed = parseDriveString(String(cfg?.[disk] ?? ''))
      const sizeOpt = parsed.ok === false ? undefined : parsed.drive.opts.find(([k]) => k === 'size')?.[1]
      const diskMb = sizeOpt ? parsePveSizeToMb(sizeOpt) : 0
      if (vdcInfo && diskMb > 0) {
        const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
          type: 'resize',
          addStorageMb: deleteSource ? 0 : diskMb,
          addStorageMbByStorage: { [storage]: diskMb },
        }, vdcInfo.storagePolicies, node)
        if (!quotaCheck.allowed) {
          return NextResponse.json({ error: 'Quota exceeded', violations: quotaCheck.violations }, { status: 409 })
        }
      }
      stampCaps = scope.storagePoliciesByConnection.get(id)?.get(storage)
    }

    // Construire les paramètres
    const moveParams: Record<string, any> = {
      disk,
      storage,
    }

    if (deleteSource) {
      moveParams.delete = 1
    }

    if (format) {
      moveParams.format = format
    }

    // Appeler l'API Proxmox
    const endpoint = resourceTypePve === 'qemu'
      ? `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/move_disk`
      : `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/move_volume`

    const result = await pveFetch<string>(
      conn,
      endpoint,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(moveParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    // Post-move storage-tier QoS restamp (qemu only): PVE preserves the
    // OLD storage's options across a move, so a disk landing on a policied
    // storage must be re-stamped with the TARGET tier's caps once the move
    // task completes.
    if (stampCaps && resourceTypePve === 'qemu') {
      const moveUpid = String(result || '')
      const cfgPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/config`
      const capsForStamp = stampCaps
      after(async () => {
        try {
          if (moveUpid) await waitForTask(conn, node, moveUpid)
          const cfg = await pveFetch<any>(conn, cfgPath)
          const current = String(cfg?.[disk] ?? '')
          const stamped = stampDriveQos(current, capsForStamp)
          if (stamped !== current && current) {
            await pveFetch<any>(conn, cfgPath, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ [disk]: stamped }).toString(),
            })
          }
        } catch (err: any) {
          console.error(`[move-qos-stamp] failed for vmid=${vmid} disk=${disk}: ${err?.message ?? err}`)
        }
      })
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: id, disk, targetStorage: storage },
    })

    return NextResponse.json({
      success: true,
      data: result,
      message: `Déplacement du disque ${disk} vers ${storage} lancé`
    })
  } catch (e: any) {
    console.error('Error moving disk:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
