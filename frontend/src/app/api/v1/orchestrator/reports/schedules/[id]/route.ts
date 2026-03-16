// src/app/api/v1/orchestrator/reports/schedules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

async function verifyScheduleBelongsToTenant(id: string): Promise<{ data: any; allowed: boolean }> {
  const data = await orchestratorFetch(`/reports/schedules/${id}`) as any
  if (data?.connection_id) {
    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(data.connection_id)) {
      return { data, allowed: false }
    }
  }
  return { data, allowed: true }
}

// GET /api/v1/orchestrator/reports/schedules/[id] - Get a single schedule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { data, allowed } = await verifyScheduleBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

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
    const { id } = await params
    const { allowed } = await verifyScheduleBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

    const body = await request.json()
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
    const { id } = await params
    const { allowed } = await verifyScheduleBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

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
