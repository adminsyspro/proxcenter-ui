import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkExecutionTenantScope } from "@/lib/orchestrator/executionScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/replication/executions/{id}/events?after=<id>
// The step log of a failover or failback (ui#943), behind the same gate and
// tenant scope as the execution it belongs to.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkExecutionTenantScope(id)

    if (scopeDenied) return scopeDenied

    const after = Number(new URL(request.url).searchParams.get("after") || 0)
    const response = await getOrchestratorClient().getExecutionEvents(id, Number.isInteger(after) && after > 0 ? after : 0)

    return NextResponse.json(Array.isArray(response.data) ? response.data : [])
  } catch (e: any) {
    if (e?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Error fetching execution events:", e)
    }

    return NextResponse.json({ error: e?.message || "Failed to fetch execution events" }, { status: 500 })
  }
}
