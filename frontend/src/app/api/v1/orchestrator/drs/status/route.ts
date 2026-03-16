// src/app/api/v1/orchestrator/drs/status/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/status — tenant-scoped
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()

    // Fetch recommendations + migrations to recompute counts for tenant
    const [statusRes, recsRes, migsRes] = await Promise.all([
      client.getDRSStatus(),
      client.getRecommendations(false).catch(() => ({ data: [] })),
      client.getActiveMigrations().catch(() => ({ data: [] })),
    ])

    const recs = Array.isArray(recsRes.data) ? recsRes.data : []
    const migs = Array.isArray(migsRes.data) ? migsRes.data : []

    const filteredRecs = recs.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))
    const filteredMigs = migs.filter((m: any) => !m.connection_id || tenantConnectionIds.has(m.connection_id))

    const status = statusRes.data || {}

    return NextResponse.json({
      ...status,
      recommendations: filteredRecs.length,
      active_migrations: filteredMigs.length,
      pending_count: filteredRecs.filter((r: any) => r.status === 'pending').length,
      approved_count: filteredRecs.filter((r: any) => r.status === 'approved').length,
    })
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching DRS status:", e)
    }

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
