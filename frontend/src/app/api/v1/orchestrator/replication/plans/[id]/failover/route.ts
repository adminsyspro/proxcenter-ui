import { NextRequest, NextResponse } from "next/server"

import { replicationErrorResponse } from '@/lib/orchestrator/replicationError'
import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPlanTenantScope } from "@/lib/orchestrator/planTenantScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handlePost(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    const body = await request.json().catch(() => undefined)
    const response = await getOrchestratorClient().executeFailover(id, body)

    return NextResponse.json(response.data)
  } catch (error) {
    return replicationErrorResponse(error, 'Failed to execute failover')
  }
}

export const POST = withAudit({ category: "replication", resourceType: "plan", resourceParam: "id", action: "failover" }, handlePost)
