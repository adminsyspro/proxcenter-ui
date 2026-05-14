// src/app/api/v1/orchestrator/reports/schedules/[id]/run/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

// POST /api/v1/orchestrator/reports/schedules/[id]/run - Run schedule now.
// Tenant ownership is enforced by the orchestrator (X-Tenant-ID header set
// by orchestratorFetch returns 404 for cross-tenant ids).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params

    const data = await orchestratorFetch(`/reports/schedules/${id}/run`, {
      method: 'POST'
    })

    return NextResponse.json(data, { status: 202 })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to run schedule:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to run schedule' },
      { status: 500 }
    )
  }
}
