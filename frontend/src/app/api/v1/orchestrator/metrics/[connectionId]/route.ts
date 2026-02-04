// src/app/api/v1/orchestrator/metrics/[connectionId]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ connectionId: string }>
}

// GET /api/v1/orchestrator/metrics/:connectionId
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { connectionId } = await params
    
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getMetrics(connectionId)
    
    return NextResponse.json(response.data || null)
  } catch (e: any) {
    console.error("Error fetching cluster metrics:", e)
    
return NextResponse.json(
      { error: e?.message || "Failed to fetch cluster metrics" },
      { status: 500 }
    )
  }
}
