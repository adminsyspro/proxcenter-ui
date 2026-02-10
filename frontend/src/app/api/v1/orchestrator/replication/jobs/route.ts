import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getReplicationJobs()

    return NextResponse.json(response.data || [])
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.createReplicationJob(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error creating replication job:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to create replication job" },
      { status: 500 }
    )
  }
}
