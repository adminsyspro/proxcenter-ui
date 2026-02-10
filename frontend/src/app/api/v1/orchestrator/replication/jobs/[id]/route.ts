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
    const response = await client.getReplicationJob(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching replication job:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to fetch replication job" },
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
    const response = await client.updateReplicationJob(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error updating replication job:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to update replication job" },
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
    const response = await client.deleteReplicationJob(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error deleting replication job:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to delete replication job" },
      { status: 500 }
    )
  }
}
