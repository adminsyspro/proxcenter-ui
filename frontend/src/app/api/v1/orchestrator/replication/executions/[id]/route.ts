import { NextRequest, NextResponse } from "next/server"

import { checkExecutionTenantScope } from "@/lib/orchestrator/executionScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied, execution } = await checkExecutionTenantScope(id)

    if (scopeDenied) return scopeDenied

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
