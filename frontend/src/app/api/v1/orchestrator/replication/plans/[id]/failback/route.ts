import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    const response = await client.executeFailback(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error executing failback:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to execute failback" },
      { status: 500 }
    )
  }
}
