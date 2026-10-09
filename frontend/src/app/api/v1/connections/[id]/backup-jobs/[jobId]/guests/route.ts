import { NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { planAddGuestToJob, type VzdumpJob } from "@/lib/backups/coverage"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getAllowedJobPools } from "@/lib/vdc/backupJobs"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

async function auditAdd(connId: string, jobId: string, details: Record<string, any>, error?: string) {
  try {
    await audit({
      action: "update",
      category: "backups",
      resourceType: "backup_job",
      resourceId: `${connId}:${jobId}`,
      resourceName: jobId,
      details: { connectionId: connId, operation: "add_guest", ...details },
      status: error ? "failure" : "success",
      ...(error ? { errorMessage: error } : {}),
    })
  } catch (auditErr) {
    console.warn("Failed to write the backup job audit row:", auditErr)
  }
}

/**
 * POST /api/v1/connections/[id]/backup-jobs/[jobId]/guests  { vmid }
 *
 * Adds one guest to an existing vzdump job (backup coverage, roadmap#48):
 * an `all` job drops it from its exclusions, a `vmid` job gets it appended.
 * Pool jobs, jobs pinned to another node and jobs that already select it are
 * refused with 409 and the reason. Only the selection field that changes is
 * sent to PVE, so schedule, retention, notes and every other option stay as
 * they are. vDC tenants have their own pool-based flow and are refused here.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const vmid = String(body?.vmid ?? "").trim()

    if (!id || !jobId || !/^\d+$/.test(vmid)) {
      return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_EDIT, "connection", id)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    if ((await getAllowedJobPools(tenantId, id)) !== null) {
      return NextResponse.json({ error: "Not available to a vDC tenant" }, { status: 403 })
    }

    const conn = await getConnectionById(id)

    // The guest's node comes from the cluster, not from the caller: it is
    // what decides whether a node-restricted job would ever back it up.
    const resources = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
    const guest = (resources || []).find((r: any) => String(r?.vmid) === vmid)
    if (!guest) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 })
    }

    let job: VzdumpJob
    try {
      job = await pveFetch<VzdumpJob>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`)
    } catch (err: any) {
      const msg = String(err?.message || "")
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 })
      }
      throw err
    }

    const plan = planAddGuestToJob(job, { vmid, node: String(guest.node || "") })
    if (plan.ok === false) {
      return NextResponse.json({ error: "This job cannot take the guest", reason: plan.reason }, { status: 409 })
    }

    const params = new URLSearchParams(plan.set)
    if (plan.remove.length) params.set("delete", plan.remove.join(","))

    const details = { vmid: Number(vmid), guestName: guest.name, set: plan.set, delete: plan.remove, jobDisabled: plan.disabled }
    try {
      await pveFetch<any>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      })
    } catch (e: any) {
      await auditAdd(id, jobId, details, e?.message || String(e))
      throw e
    }
    await auditAdd(id, jobId, details)

    return NextResponse.json({ data: { jobId, vmid: Number(vmid), disabled: plan.disabled } })
  } catch (e: any) {
    console.error("[backup-jobs/guests] POST error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
