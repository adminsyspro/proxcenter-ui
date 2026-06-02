// src/app/api/v1/orchestrator/reports/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { applyReportRequestScope } from '@/lib/reports/connectionScope'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports - List reports.
// Tenant scoping is enforced by the orchestrator via the X-Tenant-ID header
// injected in orchestratorFetch; this route just forwards pagination params.
export async function GET(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get('limit') || '50')
    const offset = Number.parseInt(searchParams.get('offset') || '0')
    const type = searchParams.get('type') || ''
    const status = searchParams.get('status') || ''

    let url = `/reports?limit=${limit}&offset=${offset}`
    if (type) url += `&type=${type}`
    if (status) url += `&status=${status}`

    const data = await orchestratorFetch(url)
    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get reports:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to get reports' },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/reports - Generate a new report (scoped to tenant connections)
export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const body = await request.json()

    // Enforce the report-type allow-list + resolve the connection scope (vDC
    // forced to its slice, provider narrow-only, 'vdc' type cleared). Authoritative.
    const scopeDenied = await applyReportRequestScope(body)
    if (scopeDenied) return scopeDenied

    const data = await orchestratorFetch('/reports', {
      method: 'POST',
      body
    })

    return NextResponse.json(data, { status: 202 })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to generate report:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to generate report' },
      { status: 500 }
    )
  }
}
