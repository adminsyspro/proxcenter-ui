// src/app/api/v1/orchestrator/drs/status/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/status
export async function GET() {
  try {
    // RBAC: Vérifier la permission de voir le DRS
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getDRSStatus()
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching DRS status:", e)

    // Retourner un status par défaut en cas d'erreur
    return NextResponse.json({
      enabled: false,
      mode: 'manual',
      recommendations: 0,
      active_migrations: 0,
      pending_count: 0,
      approved_count: 0
    })
  }
}
