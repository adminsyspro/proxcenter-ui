// src/app/api/v1/orchestrator/drs/migrations/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/migrations — tenant-filtered
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const active = searchParams.get('active')

    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()

    const response = active === 'true'
      ? await client.getActiveMigrations()
      : await client.getMigrations()

    const all = Array.isArray(response.data) ? response.data : []
    const filtered = all.filter((m: any) => !m.connection_id || tenantConnectionIds.has(m.connection_id))

    return NextResponse.json(filtered)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching migrations:", e)
    }

    // Retourner un tableau vide en cas d'erreur pour éviter les erreurs frontend
    return NextResponse.json([])
  }
}
