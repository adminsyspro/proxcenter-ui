import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient, parseOrchestratorError } from "@/lib/orchestrator/client"
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

    const response = await client.failbackCutover(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error executing failback cutover:", e)
    }

    const upstream = parseOrchestratorError(e)

    if (upstream) {
      return NextResponse.json({ error: upstream.message }, { status: upstream.status })
    }

    return NextResponse.json(
      { error: e?.message || "Failed to execute failback cutover" },
      { status: 500 }
    )
  }
}
