import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Tenant ownership check via the job itself
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

    const response = await client.getReplicationJobVMs(id)
    return NextResponse.json(response.data || [])
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching replication job VMs:", e)
    }
    return NextResponse.json([])
  }
}
