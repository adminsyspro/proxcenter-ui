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

    let body: { network_isolated?: boolean; restore_points?: Record<number, string>; screenshot_delay_seconds?: number } | undefined
    try { body = await request.json() } catch { /* empty body is fine */ }
    const response = await getOrchestratorClient().testFailover(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error executing test failover:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to execute test failover" },
      { status: 500 }
    )
  }
}
