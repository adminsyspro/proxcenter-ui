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
    const response = await client.getExecution(id)
    const execution = response.data

    // Verify ownership: check execution's cluster fields or trace back via plan
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
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }
      } catch {
        // Plan may have been deleted; fall through to return the execution
      }
    } else if (
      execution &&
      ((execution.source_cluster && !tenantConnectionIds.has(execution.source_cluster)) ||
      (execution.target_cluster && !tenantConnectionIds.has(execution.target_cluster)))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(execution)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching execution:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch execution" },
      { status: 500 }
    )
  }
}
