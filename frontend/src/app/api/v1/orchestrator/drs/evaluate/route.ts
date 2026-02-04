// src/app/api/v1/orchestrator/drs/evaluate/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// POST /api/v1/orchestrator/drs/evaluate
export async function POST() {
  try {
    // RBAC: Vérifier la permission d'exécuter des actions DRS
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_EXECUTE, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.triggerEvaluation()
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error triggering DRS evaluation:", e)
    
return NextResponse.json(
      { error: e?.message || "Failed to trigger DRS evaluation" },
      { status: 500 }
    )
  }
}
