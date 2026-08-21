import { NextResponse, after } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { waitForTask } from "@/lib/proxmox/tasks"
import { restampGuestDrives } from "@/lib/vdc/driveGuard"
import type { DriveQosCaps } from "@/lib/vdc/drives"
import { safeLog } from "@/lib/log/sanitize"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
  snapname: string
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

async function getConnection(id: string) {
  // Use the shared helper so vDC tenants reach provider-owned connections
  // through their vDC scope instead of getting a tenant-scoped 404.
  try {
    return await getConnectionById(id)
  } catch {
    return null
  }
}

/**
 * POST /api/v1/guests/[vmid]/snapshots/[snapname]
 * Rollback vers un snapshot
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)
    const snapname = params.snapname

    // RBAC: Check vm.snapshot permission for rollback
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Storage-tier QoS policies (Finding I1): a snapshot taken before a
    // storage policy existed re-applies its own drive lines verbatim on
    // rollback, potentially handing back self-chosen QoS on a now-policied
    // storage. Resolved eagerly (union scope, iaas only) ahead of the PVE
    // rollback call and reused by the post-rollback restamp after() block
    // below (cookies/request context die inside after()). The restamp is
    // best-effort by design (spec §5.3): a DB/scope failure here must not
    // turn a previously DB-free rollback into a 500, so it falls back to an
    // empty policies map (no restamp scheduled) rather than throwing.
    let rollbackPolicies: Map<string, DriveQosCaps> = new Map()
    try {
      const tenantId = await getCurrentTenantId()
      const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
      rollbackPolicies = infra.kind === 'iaas' && infra.vdcScope
        ? (infra.vdcScope.storagePoliciesByConnection.get(connId) ?? new Map())
        : new Map()
    } catch (err: any) {
      console.warn(`[rollback-qos-stamp] scope resolution failed for vmid=${safeLog(vmid)}, restamp skipped: ${safeLog(err?.message ?? err)}`)
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`

    const result = await pveFetch<string>(conn, apiPath, {
      method: 'POST',
    })

    // ── Post-rollback storage-tier QoS restamp ──
    // qemu only: DATA_DISK_KEY_RE (inside restampGuestDrives) only matches
    // qemu drive keys, lxc mountpoints use a different shape entirely
    // (mirrors the clone/restore after() blocks).
    if (type === 'qemu' && rollbackPolicies.size > 0 && result) {
      const upid = String(result)
      const configPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/config`
      const rollbackLogTag = `[rollback-qos-stamp] vmid=${safeLog(vmid)}`
      after(async () => {
        try {
          await waitForTask(conn, node, upid)
        } catch (err: any) {
          console.error(`${rollbackLogTag} waitForTask failed: ${safeLog(err?.message ?? err)}`)
          return
        }
        await restampGuestDrives({ conn, configPath, policies: rollbackPolicies, logTag: rollbackLogTag })
      })
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "restore",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: connId, snapshotName: snapname },
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: `Rollback to snapshot '${snapname}' started`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot rollback error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/guests/[vmid]/snapshots/[snapname]
 * Mettre à jour la description d'un snapshot
 * Body: { description: string }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)
    const snapname = params.snapname

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const body = await req.json()

    const { description } = body

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`
    
    const formData = new URLSearchParams()

    formData.append('description', description || '')
    
    await pveFetch<any>(conn, apiPath, {
      method: 'PUT',
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: connId, snapshotName: snapname, description },
    })

    return NextResponse.json({
      data: {
        success: true,
        message: `Snapshot '${snapname}' description updated`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot update error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
