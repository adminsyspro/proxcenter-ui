import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// POST /api/v1/orchestrator/drs/rules/[id]/enforce — tenant-scoped
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_EXECUTE, "global", "*")
    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Verify rule belongs to tenant
    const rulesRes = await client.getRules()
    const rules = Array.isArray(rulesRes.data) ? rulesRes.data : []
    const rule = rules.find((r: any) => r.id === id)
    if (rule?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(rule.connection_id)) {
        return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
      }
    }

    const response = await client.enforceRule(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error enforcing DRS rule:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to enforce DRS rule" },
      { status: 500 }
    )
  }
}
