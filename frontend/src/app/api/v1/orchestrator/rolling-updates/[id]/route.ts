import { NextResponse } from "next/server"

import { getTenantConnectionIds } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// GET /api/v1/orchestrator/rolling-updates/[id] — tenant-scoped
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW)
    if (denied) return denied

    const { id } = await ctx.params

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates/${id}`, {
      headers: orchestratorHeaders({ "Content-Type": "application/json" }),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Rolling update not found" },
        { status: response.status }
      )
    }

    // Verify rolling update belongs to tenant
    const ru = data?.data || data
    if (ru?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(ru.connection_id)) {
        return NextResponse.json({ error: 'Rolling update not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error getting rolling update:", error)
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
