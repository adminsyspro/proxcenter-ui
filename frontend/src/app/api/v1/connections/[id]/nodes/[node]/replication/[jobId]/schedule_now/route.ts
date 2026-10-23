import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardSessionGuest, replicationJobVmid } from "@/lib/vdc/guestGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// POST - Exécuter immédiatement un job de réplication
async function handlePost(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params
  // PVE job ids are <vmid>-<n>: the guest whose job this is comes from the id itself.
  const vmid = replicationJobVmid(jobId)
  if (!vmid) return NextResponse.json({ error: "Invalid jobId" }, { status: 400 })

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type: null, node: null, vmid })
  if (scopeDenied) return scopeDenied

  try {
    // Exécuter le job de réplication immédiatement
    const result = await pveFetch(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/schedule_now`,
      { method: 'POST' }
    )

    return NextResponse.json({ data: result, success: true })
  } catch (error: any) {
    console.error(`Error scheduling replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to schedule replication job"
    }, { status: 500 })
  }
}

export const POST = withAudit({ category: "replication", resourceType: "replication", resourceParam: "jobId", action: "sync" }, handlePost)
