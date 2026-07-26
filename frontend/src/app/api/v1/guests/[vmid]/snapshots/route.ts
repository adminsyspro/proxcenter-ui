import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { pveFetch } from "@/lib/proxmox/client"
import { waitForTask } from "@/lib/proxmox/tasks"
import { getConnectionByIdOrNull } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getDateLocale } from "@/lib/i18n/date"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

function parseVmKey(vmKey: string) {
  const parts = vmKey.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid vmKey format. Expected connId:type:node:vmid')
  }

  
return {
    connId: parts[0],
    type: parts[1],
    node: parts[2],
    vmid: parts[3],
  }
}

/**
 * GET /api/v1/guests/[vmid]/snapshots
 * Liste les snapshots d'une VM
 * vmid format: connId:type:node:vmid
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
    const snapshots = await pveFetch<any[]>(conn, apiPath)

    // Filtrer "current" et formater
    const formatted = (snapshots || [])
      .filter(s => s.name !== 'current')
      .map(s => ({
        name: s.name,
        description: s.description || '',
        snaptime: s.snaptime || 0,
        snaptimeFormatted: s.snaptime
          ? new Date(s.snaptime * 1000).toLocaleString(dateLocale)
          : '-',
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
export async function POST(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

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

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
    
    const formData = new URLSearchParams()

    formData.append('snapname', name)
    if (description) formData.append('description', description)
    if (vmstate !== undefined && type !== 'lxc') formData.append('vmstate', vmstate ? '1' : '0')

    const result = await pveFetch<string>(conn, apiPath, {
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
    console.error("Snapshot create error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/guests/[vmid]/snapshots
 * Supprimer un snapshot
 * Query: ?name=snapshot_name
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

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

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}`

    const result = await pveFetch<string>(conn, apiPath, {
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
    console.error("Snapshot delete error:", String(e?.message || e).replace(/[\r\n]/g, ''))

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
