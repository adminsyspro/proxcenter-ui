import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.stopDRVM(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error stopping DR VM:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to stop DR VM" },
      { status: 500 }
    )
  }
}
