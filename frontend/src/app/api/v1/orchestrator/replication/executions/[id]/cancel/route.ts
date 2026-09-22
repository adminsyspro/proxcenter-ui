import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkExecutionTenantScope } from "@/lib/orchestrator/executionScope"
import { replicationErrorResponse } from "@/lib/orchestrator/replicationError"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * Stop a Site Recovery execution from its task row (#974).
 *
 * What the orchestrator accepts depends on what the run has already done to
 * the guests: a test failover stops at any point (its cleanup takes the
 * started guests down), a failback follows the rules failback-cancel has
 * always had, and a real failover stops only before it has fenced its first
 * guest. Every refusal comes back as a 409 carrying its reason, which the
 * task row shows as is.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkExecutionTenantScope(id)

    if (scopeDenied) return scopeDenied

    const response = await getOrchestratorClient().cancelRecoveryExecution(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error cancelling recovery execution:", e)
    }

    return replicationErrorResponse(e, "Failed to stop the recovery execution")
  }
}
