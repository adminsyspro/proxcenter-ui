// src/app/api/v1/orchestrator/reports/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

async function verifyReportBelongsToTenant(id: string): Promise<{ data: any; allowed: boolean }> {
  const data = await orchestratorFetch(`/reports/${id}`) as any
  if (data?.connection_id) {
    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(data.connection_id)) {
      return { data, allowed: false }
    }
  }
  return { data, allowed: true }
}

// GET /api/v1/orchestrator/reports/[id] - Get a single report
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { data, allowed } = await verifyReportBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

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
    const { id } = await params
    const { allowed } = await verifyReportBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

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
