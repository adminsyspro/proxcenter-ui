import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Verify plan ownership
    const tenantConnectionIds = await getTenantConnectionIds()
    const planResponse = await client.getRecoveryPlan(id)
    const plan = planResponse.data

    if (
      plan &&
      ((plan.source_cluster && !tenantConnectionIds.has(plan.source_cluster)) ||
      (plan.target_cluster && !tenantConnectionIds.has(plan.target_cluster)))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const response = await client.cleanupTestFailover(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error cleaning up test failover:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to cleanup test failover" },
      { status: 500 }
    )
  }
}
