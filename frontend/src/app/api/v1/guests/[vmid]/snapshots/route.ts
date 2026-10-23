import { NextResponse } from "next/server"
import { licenseExcludedResponse } from "@/lib/api/response"

import { pveFetch } from "@/lib/proxmox/client"
import { waitForTask } from "@/lib/proxmox/tasks"
import { getConnectionByIdOrNull } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { guardSessionGuest, parseGuestKey, type GuestTarget } from "@/lib/vdc/guestGuard"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

/** Every segment of the PVE snapshot path is encoded: validated or not, nothing reshapes the URL. */
function snapshotPath({ type, node, vmid }: GuestTarget, snapname?: string) {
  const base = `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/snapshot`
  return snapname === undefined ? base : `${base}/${encodeURIComponent(snapname)}`
}

/**
 * GET /api/v1/guests/[vmid]/snapshots
 * Liste les snapshots d'une VM
 * vmid format: connId:type:node:vmid
 */
async function getHandler(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const key = parseGuestKey(params.vmid)
    if (!key.ok) return key.response
    const { connId, type, node, vmid } = key

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    const snapshots = await pveFetch<any[]>(conn, snapshotPath(key))

    // Filtrer "current" et formater
    const formatted = (snapshots || [])
      .filter(s => s.name !== 'current')
      .map(s => ({
        name: s.name,
        description: s.description || '',
        // `snaptime` reste l'epoch UTC brut, mis en forme par le navigateur :
        // formater ici sortait l'heure du conteneur (UTC) au lieu de celle du
        // visiteur (même cause que l'issue #843, cf. discussion #379).
        snaptime: s.snaptime || 0,
        vmstate: s.vmstate || false,
        parent: s.parent || null,
      }))
      .sort((a, b) => b.snaptime - a.snaptime)

    return NextResponse.json({
      data: {
        snapshots: formatted,
        count: formatted.length,
      }
    })
  } catch (e: any) {
    console.error("Snapshots list error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/guests/[vmid]/snapshots
 * Créer un nouveau snapshot
 * Body: { name: string, description?: string, vmstate?: boolean }
 */
async function postHandler(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const key = parseGuestKey(params.vmid)
    if (!key.ok) return key.response
    const { connId, type, node, vmid } = key

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const body = await req.json()

    const { name, description, vmstate } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: "Snapshot name is required" }, { status: 400 })
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({
        error: "Invalid snapshot name. Use only letters, numbers, dashes and underscores."
      }, { status: 400 })
    }

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    // ── vDC quota: enforce maxSnapshots across the tenant's pool ──
    const tenantId = await getCurrentTenantId()
    try {
      const vdcInfo = await resolveVdcForTenant(tenantId, connId, node)
      if (vdcInfo) {
        const quotaCheck = await checkVdcQuota(connId, vdcInfo.poolName, vdcInfo.quota, {
          type: 'snapshot',
          addSnapshots: 1,
        })
        if (!quotaCheck.allowed) {
          return NextResponse.json({
            error: 'Quota exceeded',
            violations: quotaCheck.violations,
          }, { status: 409 })
        }
      }
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }
      throw e
    }

    const formData = new URLSearchParams()

    formData.append('snapname', name)
    if (description) formData.append('description', description)
    if (vmstate !== undefined && type !== 'lxc') formData.append('vmstate', vmstate ? '1' : '0')

    const result = await pveFetch<string>(conn, snapshotPath(key), {
      method: 'POST',
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "snapshot",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: connId, snapshotName: name },
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: `Snapshot '${name}' creation started`,
      }
    })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    console.error("Snapshot create error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/guests/[vmid]/snapshots
 * Supprimer un snapshot
 * Query: ?name=snapshot_name
 */
async function deleteHandler(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const key = parseGuestKey(params.vmid)
    if (!key.ok) return key.response
    const { connId, type, node, vmid } = key

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const url = new URL(req.url)
    const snapname = url.searchParams.get('name')

    if (!snapname) {
      return NextResponse.json({ error: "Snapshot name is required" }, { status: 400 })
    }

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    const result = await pveFetch<string>(conn, snapshotPath(key, snapname), {
      method: 'DELETE',
    })

    // Opt-in: block until the PVE task actually finishes. Used by the VM
    // Snapshots-tab "Delete all" action, which deletes snapshots sequentially.
    const shouldWait = url.searchParams.get('wait') === '1'
    if (shouldWait) {
      await waitForTask(conn, node, result)
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "delete",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: connId, snapshotName: snapname },
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: shouldWait
          ? `Snapshot '${snapname}' deleted`
          : `Snapshot '${snapname}' deletion started`,
      }
    })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    console.error("Snapshot delete error:", String(e?.message || e).replace(/[\r\n]/g, ''))

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vm-snapshots-list", getHandler)
export const POST = withAudit({ category: "vms", resourceType: "guest", resourceParam: "vmid", action: "snapshot" }, withPublicApiGuard("vm-snapshot-create", postHandler))
export const DELETE = withAudit({ category: "vms", resourceType: "guest", resourceParam: "vmid" }, withPublicApiGuard("vm-snapshot-delete", deleteHandler))
