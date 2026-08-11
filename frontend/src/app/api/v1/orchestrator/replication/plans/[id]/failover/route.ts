import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPlanTenantScope } from "@/lib/orchestrator/planTenantScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    const body = await request.json().catch(() => undefined)
    const response = await getOrchestratorClient().executeFailover(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error executing failover:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to execute failover" },
      { status: 500 }
    )
  }
}
