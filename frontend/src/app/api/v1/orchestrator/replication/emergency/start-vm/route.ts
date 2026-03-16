import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()

    // Verify the target cluster belongs to the tenant
    const tenantConnectionIds = await getTenantConnectionIds()

    if (body.target_cluster && !tenantConnectionIds.has(body.target_cluster)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.startDRVM(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error starting DR VM:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to start DR VM" },
      { status: 500 }
    )
  }
}
