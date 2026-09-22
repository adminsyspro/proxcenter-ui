import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { replicationErrorResponse } from "@/lib/orchestrator/replicationError"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

/**
 * Stop the sync a replication job is running right now (#974).
 *
 * Pausing does not do this: PauseJob only clears next_sync and the run in
 * flight goes to its end (the orchestrator has a test locking that down), so
 * an operator watching a sync crawl over a saturated link had no way out.
 * The job itself is untouched (same schedule, same VMs, same snapshots) and
 * the next run resumes from the last common snapshot.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Same ownership check as pause/resume: a tenant may only stop a run whose
    // two clusters are both inside its perimeter.
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

    const response = await client.cancelReplicationJob(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error cancelling replication run:", e)
    }

    // Keep the orchestrator's own status: its 409 ("no run in flight on this
    // instance", which in HA means another one owns it) must reach the
    // operator as that sentence, not as a generic 500.
    return replicationErrorResponse(e, "Failed to stop the replication run")
  }
}
