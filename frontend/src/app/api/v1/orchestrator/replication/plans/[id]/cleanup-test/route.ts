import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    const response = await client.cleanupTestFailover(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error cleaning up test failover:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to cleanup test failover" },
      { status: 500 }
    )
  }
}
