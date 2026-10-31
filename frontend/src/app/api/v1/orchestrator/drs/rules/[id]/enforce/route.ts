import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { mayActOnDrsRule } from "@/lib/orchestrator/drsRuleScope"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// POST /api/v1/orchestrator/drs/rules/[id]/enforce — tenant-scoped
async function handlePost(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_EXECUTE, "global", "*")
    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()

    // Verify rule belongs to tenant
    if (!(await mayActOnDrsRule(client, id))) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
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

export const POST = withAudit({ category: "automation", resourceType: "rule", resourceParam: "id", action: "execute" }, handlePost)
