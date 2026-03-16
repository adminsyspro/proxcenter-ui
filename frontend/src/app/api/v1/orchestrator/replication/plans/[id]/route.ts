import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

/** Verify that a recovery plan belongs to the current tenant */
async function verifyPlanOwnership(id: string) {
  const client = getOrchestratorClient()
  const tenantConnectionIds = await getTenantConnectionIds()
  const response = await client.getRecoveryPlan(id)
  const plan = response.data

  if (
    plan &&
    ((plan.source_cluster && !tenantConnectionIds.has(plan.source_cluster)) ||
    (plan.target_cluster && !tenantConnectionIds.has(plan.target_cluster)))
  ) {
    return null // not owned by tenant
  }

  return plan
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(plan)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching recovery plan:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch recovery plan" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.updateRecoveryPlan(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error updating recovery plan:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to update recovery plan" },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.deleteRecoveryPlan(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error deleting recovery plan:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to delete recovery plan" },
      { status: 500 }
    )
  }
}
