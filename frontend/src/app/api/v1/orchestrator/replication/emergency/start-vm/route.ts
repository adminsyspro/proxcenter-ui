import { NextRequest, NextResponse } from "next/server"

import { replicationErrorResponse } from '@/lib/orchestrator/replicationError'
import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handlePost(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()

    // Verify the target cluster belongs to the tenant
    const tenantConnectionIds = await getTenantConnectionIds()

    if (body.target_cluster && !tenantConnectionIds.has(body.target_cluster)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.startDRVM(body)

    return NextResponse.json(response.data)
  } catch (error) {
    return replicationErrorResponse(error, 'Failed to start DR VM')
  }
}

export const POST = withAudit({ category: "replication", resourceType: "emergency", action: "start" }, handlePost)
