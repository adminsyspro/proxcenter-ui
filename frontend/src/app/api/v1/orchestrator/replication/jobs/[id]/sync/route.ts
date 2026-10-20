import { NextRequest, NextResponse } from "next/server"

import { replicationErrorResponse } from '@/lib/orchestrator/replicationError'
import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handlePost(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Verify job ownership
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

    const response = await client.syncReplicationJob(id)

    return NextResponse.json(response.data)
  } catch (error) {
    return replicationErrorResponse(error, 'Failed to trigger sync')
  }
}

export const POST = withAudit({ category: "replication", resourceType: "job", resourceParam: "id", action: "sync" }, handlePost)
