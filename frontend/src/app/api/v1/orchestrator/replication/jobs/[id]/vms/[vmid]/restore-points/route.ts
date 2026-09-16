import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient, parseOrchestratorError } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

/**
 * Restore points of ONE replicated guest, for the Emergency DR tab's per-VM
 * start. The plan-wide endpoint next door answers nothing for a guest no
 * recovery plan covers, which is most of the Emergency DR list.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id, vmid } = await params
    const vmId = Number.parseInt(vmid, 10)

    if (!Number.isInteger(vmId) || vmId <= 0) {
      return NextResponse.json({ error: "vmid must be a positive integer" }, { status: 400 })
    }

    const client = getOrchestratorClient()

    // Tenant ownership check via the job itself, like the sibling job routes.
    const tenantConnectionIds = await getTenantConnectionIds()
    const jobResponse = await client.getReplicationJob(id)
    const job = jobResponse.data

    if (
      job &&
      ((job.source_cluster && !tenantConnectionIds.has(job.source_cluster)) ||
        (job.target_cluster && !tenantConnectionIds.has(job.target_cluster)))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const response = await client.getJobVMRestorePoints(id, vmId)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching VM restore points:", e)
    }

    const upstream = parseOrchestratorError(e)

    if (upstream) {
      return NextResponse.json({ error: upstream.message }, { status: upstream.status })
    }

    return NextResponse.json({ error: e?.message || "Failed to fetch restore points" }, { status: 500 })
  }
}
