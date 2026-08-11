import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkExecutionTenantScope } from "@/lib/orchestrator/executionScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkExecutionTenantScope(id)

    if (scopeDenied) return scopeDenied

    const response = await getOrchestratorClient().getExecutionScreenshots(id)

    return NextResponse.json(response.data ?? [])
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error listing execution screenshots:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to list screenshots" },
      { status: 500 }
    )
  }
}
