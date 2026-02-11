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
    const response = await client.getExecution(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching execution:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to fetch execution" },
      { status: 500 }
    )
  }
}
