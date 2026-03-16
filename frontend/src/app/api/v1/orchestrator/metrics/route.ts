// src/app/api/v1/orchestrator/metrics/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/metrics — tenant-filtered
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()
    const response = await client.getAllMetrics()

    // Filter metrics to only include tenant's connections
    const allMetrics = response.data || {}
    if (typeof allMetrics === 'object' && !Array.isArray(allMetrics)) {
      const filtered: Record<string, any> = {}
      for (const [key, value] of Object.entries(allMetrics)) {
        if (tenantConnectionIds.has(key)) {
          filtered[key] = value
        }
      }
      return NextResponse.json(filtered)
    }

    return NextResponse.json(allMetrics)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching metrics:", e)
    }

    // Retourner un objet vide en cas d'erreur
    return NextResponse.json({})
  }
}
