// src/app/api/v1/orchestrator/reports/schedules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertReportTypeAllowed, buildScopePayloadForCurrentTenant } from '@/lib/reports/tenantScope'

export const runtime = 'nodejs'

// Tenant ownership of the schedule is enforced by the orchestrator: requests
// arrive with X-Tenant-ID and the backend returns 404 for cross-tenant ids.
// The connection_id-based guard that lived here used the wrong field name
// (singular vs the persisted plural array) and is no longer needed.

// GET /api/v1/orchestrator/reports/schedules/[id] - Get a single schedule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params
    const data = await orchestratorFetch(`/reports/schedules/${id}`)


return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get schedule:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to get schedule' },
      { status: 500 }
    )
  }
}

// PUT /api/v1/orchestrator/reports/schedules/[id] - Update a schedule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params
    const body = await request.json()

    const typeDenied = await assertReportTypeAllowed(body?.type)

    if (typeDenied) return typeDenied

    // Force connection_ids + vDC scope to the current tenant's slice on every
    // update so a vDC tenant cannot pivot a schedule onto another tenant's
    // connections or widen its scope. Backend additionally checks tenant_id
    // ownership via the X-Tenant-ID header.
    const tenantConnectionIds = await getTenantConnectionIds()

    body.connection_ids = Array.from(tenantConnectionIds)

    const scope = await buildScopePayloadForCurrentTenant()

    if (scope) {
      body.node_filter = scope.node_filter
      body.vmid_filter = scope.vmid_filter
      body.storage_filter = scope.storage_filter
    }

    const data = await orchestratorFetch(`/reports/schedules/${id}`, {
      method: 'PUT',
      body
    })

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to update schedule:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to update schedule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/orchestrator/reports/schedules/[id] - Delete a schedule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params

    const data = await orchestratorFetch(`/reports/schedules/${id}`, {
      method: 'DELETE'
    })

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to delete schedule:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to delete schedule' },
      { status: 500 }
    )
  }
}
