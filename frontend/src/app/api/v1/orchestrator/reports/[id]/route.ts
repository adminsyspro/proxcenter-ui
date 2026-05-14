// src/app/api/v1/orchestrator/reports/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

// Tenant ownership is enforced by the orchestrator via the X-Tenant-ID
// header (cross-tenant ids return 404). The local connection_id-based guard
// that lived here used the wrong field name (singular vs persisted array).

// GET /api/v1/orchestrator/reports/[id] - Get a single report
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params
    const data = await orchestratorFetch(`/reports/${id}`)


return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get report:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to get report' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/orchestrator/reports/[id] - Delete a report
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)

    if (denied) return denied

    const { id } = await params

    const data = await orchestratorFetch(`/reports/${id}`, {
      method: 'DELETE'
    })

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to delete report:', error)
    }


return NextResponse.json(
      { error: error.message || 'Failed to delete report' },
      { status: 500 }
    )
  }
}
