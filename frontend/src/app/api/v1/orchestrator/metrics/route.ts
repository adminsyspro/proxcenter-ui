// src/app/api/v1/orchestrator/metrics/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/metrics
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getAllMetrics()
    
    return NextResponse.json(response.data || {})
  } catch (e: any) {
    console.error("Error fetching metrics:", e)

    // Retourner un objet vide en cas d'erreur
    return NextResponse.json({})
  }
}
