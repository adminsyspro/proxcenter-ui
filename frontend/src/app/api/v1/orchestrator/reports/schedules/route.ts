// src/app/api/v1/orchestrator/reports/schedules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertReportTypeAllowed, buildScopePayloadForCurrentTenant } from '@/lib/reports/tenantScope'

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

    const typeDenied = await assertReportTypeAllowed(body?.type)

    if (typeDenied) return typeDenied

    // Pin schedule to the current tenant's connections so it cannot reach
    // out to another tenant's data when it fires.
    const tenantConnectionIds = await getTenantConnectionIds()

    body.connection_ids = Array.from(tenantConnectionIds)

    // Persist the vDC scope on the schedule (orchestrator replays it on fire).
    const scope = await buildScopePayloadForCurrentTenant()

    if (scope) {
      body.node_filter = scope.node_filter
      body.vmid_filter = scope.vmid_filter
      body.storage_filter = scope.storage_filter
    }

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
