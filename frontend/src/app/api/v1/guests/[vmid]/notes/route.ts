import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { guardSessionGuest, parseGuestKey, type GuestTarget } from "@/lib/vdc/guestGuard"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

/** Every segment encoded: the validated key cannot reshape the PVE path. */
const configPath = ({ type, node, vmid }: GuestTarget) =>
  `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/config`

/**
 * GET /api/v1/guests/[vmid]/notes
 * Récupère les notes (description) d'une VM depuis Proxmox
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

    // RBAC: vm.view, checked BEFORE the connection is resolved. That
    // resolution decrypts the Proxmox API token, so it must never run for a
    // caller who has no right to this guest.
    const denied = await checkPermission(
      PERMISSIONS.VM_VIEW,
      "vm",
      buildVmResourceId(connId, node, type, vmid)
    )

    if (denied) return denied

    // Use the shared resolver so tenants can reach connections they only
    // access via vDC assignment (not only the ones they own).
    let conn
    try {
      conn = await getConnectionById(connId)
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    const config = await pveFetch<any>(conn, configPath(key))

    const description = config?.description || ''

    return NextResponse.json({
      data: {
        content: description,
      }
    })
  } catch (e: any) {
    console.error("Get notes error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/guests/[vmid]/notes
 * Met à jour les notes (description) d'une VM dans Proxmox
 * Body: { content: string }
 */
async function putHandler(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const key = parseGuestKey(params.vmid)
    if (!key.ok) return key.response
    const { connId, type, node, vmid } = key

    // RBAC: vm.config. This writes the guest's description on Proxmox.
    // Checked before the body is read and before the connection is resolved.
    const denied = await checkPermission(
      PERMISSIONS.VM_CONFIG,
      "vm",
      buildVmResourceId(connId, node, type, vmid)
    )

    if (denied) return denied

    const body = await req.json()

    const { content } = body

    if (typeof content !== 'string') {
      return NextResponse.json({ error: "Content must be a string" }, { status: 400 })
    }

    // Use the shared resolver so tenants can reach connections they only
    // access via vDC assignment (not only the ones they own).
    let conn
    try {
      conn = await getConnectionById(connId)
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const scopeDenied = await guardSessionGuest({ connectionId: connId, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    const formData = new URLSearchParams()

    formData.append('description', content)

    await pveFetch<any>(conn, configPath(key), {
      method: 'PUT',
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    return NextResponse.json({
      data: {
        success: true,
        content,
      }
    })
  } catch (e: any) {
    console.error("Update notes error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vm-notes-get", getHandler)
export const PUT = withAudit({ category: "vms", resourceType: "guest", resourceParam: "vmid" }, withPublicApiGuard("vm-notes-update", putHandler))
