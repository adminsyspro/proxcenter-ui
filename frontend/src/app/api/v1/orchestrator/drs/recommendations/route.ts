// src/app/api/v1/orchestrator/drs/recommendations/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/recommendations — tenant-filtered
export async function GET(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const validate = request.nextUrl.searchParams.get('validate') === 'true'

    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()
    const response = await client.getRecommendations(validate)

    const all = Array.isArray(response.data) ? response.data : []
    const filtered = all.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))

    return NextResponse.json(filtered)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching DRS recommendations:", e)
    }

    // Retourner un tableau vide en cas d'erreur
    return NextResponse.json([])
  }
}

// POST /api/v1/orchestrator/drs/recommendations - Trigger manual evaluation
export async function POST() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.triggerEvaluation()
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error triggering DRS evaluation:", e)
    }
    
return NextResponse.json(
      { error: e?.message || "Failed to trigger evaluation" },
      { status: 500 }
    )
  }
}
