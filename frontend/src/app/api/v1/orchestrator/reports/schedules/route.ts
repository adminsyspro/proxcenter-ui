// src/app/api/v1/orchestrator/reports/schedules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/schedules - List schedules (filtered by tenant)
export async function GET() {
  try {
    const tenantConnectionIds = await getTenantConnectionIds()
    const data = await orchestratorFetch('/reports/schedules')

    const items = Array.isArray(data) ? data : ((data as any)?.data || [])
    const filtered = Array.isArray(items)
      ? items.filter((s: any) => !s.connection_id || tenantConnectionIds.has(s.connection_id))
      : items

    return NextResponse.json(filtered)
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
    const body = await request.json()

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
