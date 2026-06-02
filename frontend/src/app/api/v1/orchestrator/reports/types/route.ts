// src/app/api/v1/orchestrator/reports/types/route.ts
import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { filterReportTypesForTenant } from '@/lib/reports/tenantScope'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/types - Get available report types
// vDC tenants only receive the curated subset (Alerts, Inventory).
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const data = await orchestratorFetch('/reports/types')
    const list = Array.isArray(data) ? (data as Array<{ type: string }>) : []
    const filtered = await filterReportTypesForTenant(list)

    return NextResponse.json(filtered)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get report types:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to get report types' },
      { status: 500 }
    )
  }
}
