// src/app/api/v1/orchestrator/metrics/[connectionId]/history/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ connectionId: string }>
}

// GET /api/v1/orchestrator/metrics/:connectionId/history — tenant-scoped
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { connectionId } = await params
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined

    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    // Verify connection belongs to tenant
    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(connectionId)) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.getMetricsHistory(connectionId, from, to)

    return NextResponse.json(response.data || [])
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching metrics history:", e)
    }
    
return NextResponse.json(
      { error: e?.message || "Failed to fetch metrics history" },
      { status: 500 }
    )
  }
}
