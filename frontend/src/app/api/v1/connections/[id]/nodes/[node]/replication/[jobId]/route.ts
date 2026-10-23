import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { guardSessionGuest, replicationJobVmid } from "@/lib/vdc/guestGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

const invalidJobId = () => NextResponse.json({ error: "Invalid jobId" }, { status: 400 })

// GET - Récupérer les logs d'un job de réplication
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params
  // PVE job ids are <vmid>-<n>: the guest whose job this is comes from the id itself.
  const vmid = replicationJobVmid(jobId)
  if (!vmid) return invalidJobId()

  const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", id)
  if (denied) return denied
  const url = new URL(req.url)
  const limit = url.searchParams.get('limit') || '50'

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type: null, node: null, vmid })
  if (scopeDenied) return scopeDenied

  try {
    // Proxmox: GET /nodes/{node}/replication/{id}/log
    const logs = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/log?limit=${limit}`,
      { method: "GET" }
    )

    // Formater les logs
    const formattedLogs = Array.isArray(logs) ? logs.map((entry: any) => {
      if (typeof entry === 'string') return entry
      if (entry.t && typeof entry.t === 'string') return entry.t
      return JSON.stringify(entry)
    }) : []

    return NextResponse.json({ data: formattedLogs })
  } catch (error: any) {
    console.error(`Error fetching replication logs:`, String(error?.message || error).replace(/[\r\n]/g, ''))
    return NextResponse.json({ 
      error: error.message || "Failed to fetch replication logs",
      data: []
    }, { status: 500 })
  }
}

// POST - Exécuter immédiatement un job de réplication (Schedule now)
async function handlePost(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, node, jobId } = await ctx.params
  const vmid = replicationJobVmid(jobId)
  if (!vmid) return invalidJobId()

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type: null, node: null, vmid })
  if (scopeDenied) return scopeDenied

  try {
    // Proxmox: POST /nodes/{node}/replication/{id}/schedule_now
    const result = await pveFetch(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(jobId)}/schedule_now`,
      { method: 'POST' }
    )

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error(`Error scheduling replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to schedule replication job"
    }, { status: 500 })
  }
}

// DELETE - Supprimer un job de réplication
async function handleDelete(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string; jobId: string }> }
) {
  const { id, jobId } = await ctx.params
  const vmid = replicationJobVmid(jobId)
  if (!vmid) return invalidJobId()

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type: null, node: null, vmid })
  if (scopeDenied) return scopeDenied

  try {
    // Supprimer le job de réplication via l'API cluster
    await pveFetch(
      conn,
      `/cluster/replication/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' }
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`Error deleting replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to delete replication job"
    }, { status: 500 })
  }
}

export const POST = withAudit({ category: "replication", resourceType: "replication", resourceParam: "jobId" }, handlePost)
export const DELETE = withAudit({ category: "replication", resourceType: "replication", resourceParam: "jobId" }, handleDelete)
