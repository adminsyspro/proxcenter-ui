import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { getTenantConnectionIds } from "@/lib/tenant"

/**
 * Tenant-scope guard shared by every recovery-plan route: fetches the plan
 * and verifies its source/target clusters belong to the current tenant.
 * Returns both the fetched plan and the denial response to send (or null
 * when access is allowed), so callers that also need the plan body don't
 * have to fetch it a second time.
 *
 * Mirrors checkExecutionTenantScope's shape/contract for execution routes.
 */
export async function checkPlanTenantScope(planId: string): Promise<{ denied: NextResponse | null; plan: any }> {
  const client = getOrchestratorClient()
  const tenantConnectionIds = await getTenantConnectionIds()
  const planResponse = await client.getRecoveryPlan(planId)
  const plan = planResponse.data

  if (
    plan &&
    ((plan.source_cluster && !tenantConnectionIds.has(plan.source_cluster)) ||
    (plan.target_cluster && !tenantConnectionIds.has(plan.target_cluster)))
  ) {
    return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }), plan }
  }

  return { denied: null, plan }
}
