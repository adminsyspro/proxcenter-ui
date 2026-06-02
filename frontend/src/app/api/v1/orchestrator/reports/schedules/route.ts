// src/app/api/v1/orchestrator/reports/schedules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { applyReportRequestScope } from '@/lib/reports/connectionScope'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/schedules - List schedules.
// Tenant scoping is enforced by the orchestrator via the X-Tenant-ID header.
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const data = await orchestratorFetch('/reports/schedules')
    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get schedules:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to get schedules' },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/reports/schedules - Create a new schedule
export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const body = await request.json()

    // Enforce the report-type allow-list + resolve the connection scope (vDC
    // forced to its slice, provider narrow-only, 'vdc' type cleared). Authoritative.
    const scopeDenied = await applyReportRequestScope(body)
    if (scopeDenied) return scopeDenied

    const data = await orchestratorFetch('/reports/schedules', {
      method: 'POST',
      body
    })

    return NextResponse.json(data, { status: 201 })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to create schedule:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create schedule' },
      { status: 500 }
    )
  }
}
