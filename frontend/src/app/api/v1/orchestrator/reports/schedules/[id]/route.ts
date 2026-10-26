// src/app/api/v1/orchestrator/reports/schedules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch, orchestratorPath } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { applyReportRequestScope } from '@/lib/reports/connectionScope'
import { withAudit } from '@/lib/audit/withAudit'

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
    const data = await orchestratorFetch(orchestratorPath`/reports/schedules/${id}`)
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
async function handlePut(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const { id } = await params
    const body = await request.json()

    // Enforce the report-type allow-list + resolve the connection scope (vDC
    // forced to its slice, provider narrow-only, 'vdc' type cleared). Authoritative.
    const scopeDenied = await applyReportRequestScope(body)
    if (scopeDenied) return scopeDenied

    const data = await orchestratorFetch(orchestratorPath`/reports/schedules/${id}`, {
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
async function handleDelete(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const { id } = await params
    const data = await orchestratorFetch(orchestratorPath`/reports/schedules/${id}`, {
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

export const PUT = withAudit({ category: 'alerts', resourceType: 'schedule', resourceParam: 'id' }, handlePut)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'schedule', resourceParam: 'id' }, handleDelete)
