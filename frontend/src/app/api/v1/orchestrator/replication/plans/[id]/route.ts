import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { replicationErrorResponse } from "@/lib/orchestrator/replicationError"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"
import { getReplicationScope, itemForAction } from "@/lib/orchestrator/replicationScope"

export const runtime = "nodejs"

/**
 * The plan when the current tenant may act on it. A plan whose connection was
 * deleted is reachable by the provider for reading and deletion only (ui#1394).
 */
async function verifyPlanOwnership(id: string, allowOrphan = false) {
  const client = getOrchestratorClient()
  const [scope, response] = await Promise.all([getReplicationScope(), client.getRecoveryPlan(id)])

  return itemForAction(response.data, scope, { allowOrphan })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id, true)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(plan)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching recovery plan:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch recovery plan" },
      { status: 500 }
    )
  }
}

async function handlePut(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.updateRecoveryPlan(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error updating recovery plan:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to update recovery plan" },
      { status: 500 }
    )
  }
}

async function handleDelete(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const plan = await verifyPlanOwnership(id, true)

    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.deleteRecoveryPlan(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    // 409 while a test failover, an execution or a failback holds the plan: keep the orchestrator's status
    return replicationErrorResponse(e, "Failed to delete recovery plan")
  }
}

export const PUT = withAudit({ category: "replication", resourceType: "plan", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "replication", resourceType: "plan", resourceParam: "id" }, handleDelete)
