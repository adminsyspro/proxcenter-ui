import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    const response = await client.getRecoveryPlan(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching recovery plan:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to fetch recovery plan" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.updateRecoveryPlan(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error updating recovery plan:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to update recovery plan" },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    const response = await client.deleteRecoveryPlan(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error deleting recovery plan:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to delete recovery plan" },
      { status: 500 }
    )
  }
}
