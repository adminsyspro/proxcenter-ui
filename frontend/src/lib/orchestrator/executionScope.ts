import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { getTenantConnectionIds } from "@/lib/tenant"

/**
 * Tenant-scope guard for execution-scoped routes: fetches the execution,
 * traces back to its plan and verifies the plan's clusters belong to the
 * current tenant (same rules as the execution detail route). Returns both
 * the fetched execution and the denial response to send (or null when
 * access is allowed), so callers that also need the execution body — the
 * detail route — don't have to fetch it a second time.
 */
export async function checkExecutionTenantScope(executionId: string): Promise<{ denied: NextResponse | null; execution: any }> {
  const client = getOrchestratorClient()
  const response = await client.getExecution(executionId)
  const execution = response.data
  const tenantConnectionIds = await getTenantConnectionIds()

  if (execution?.plan_id) {
    try {
      const planResponse = await client.getRecoveryPlan(execution.plan_id)
      const plan = planResponse.data

      if (
        plan &&
        ((plan.source_cluster && !tenantConnectionIds.has(plan.source_cluster)) ||
        (plan.target_cluster && !tenantConnectionIds.has(plan.target_cluster)))
      ) {
        return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }), execution }
      }
    } catch {
      // Plan may have been deleted; keep the execution visible, consistent
      // with the execution detail route.
    }
  } else if (
    execution &&
    ((execution.source_cluster && !tenantConnectionIds.has(execution.source_cluster)) ||
    (execution.target_cluster && !tenantConnectionIds.has(execution.target_cluster)))
  ) {
    return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }), execution }
  }

  return { denied: null, execution }
}
