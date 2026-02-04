// src/app/api/v1/orchestrator/metrics/[connectionId]/history/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ connectionId: string }>
}

// GET /api/v1/orchestrator/metrics/:connectionId/history
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { connectionId } = await params
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getMetricsHistory(connectionId, from, to)
    
    return NextResponse.json(response.data || [])
  } catch (e: any) {
    console.error("Error fetching metrics history:", e)
    
return NextResponse.json(
      { error: e?.message || "Failed to fetch metrics history" },
      { status: 500 }
    )
  }
}
