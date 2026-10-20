import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPlanTenantScope } from "@/lib/orchestrator/planTenantScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    const response = await getOrchestratorClient().getRecoveryHistory(id)

    return NextResponse.json(response.data || [])
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching recovery history:", e)
    }

    return NextResponse.json([])
  }
}

async function handleDelete(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    const response = await getOrchestratorClient().clearRecoveryHistory(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error clearing recovery history:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to clear recovery history" },
      { status: 500 }
    )
  }
}

export const DELETE = withAudit({ category: "replication", resourceType: "plan", resourceParam: "id" }, handleDelete)
