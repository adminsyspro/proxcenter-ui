// src/app/api/v1/orchestrator/reports/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports - List reports (filtered by tenant)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const type = searchParams.get('type') || ''
    const status = searchParams.get('status') || ''

    let url = `/reports?limit=500&offset=0`
    if (type) url += `&type=${type}`
    if (status) url += `&status=${status}`

    const tenantConnectionIds = await getTenantConnectionIds()
    const data = await orchestratorFetch(url)

    // Filter reports by tenant connections
    const items = Array.isArray(data) ? data : ((data as any)?.data || [])
    const filtered = Array.isArray(items)
      ? items.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))
      : items

    const sliced = Array.isArray(filtered) ? filtered.slice(offset, offset + limit) : filtered

    return NextResponse.json({
      ...(typeof data === 'object' && !Array.isArray(data) ? data : {}),
      data: sliced,
      total: Array.isArray(filtered) ? filtered.length : 0,
    })
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
    const body = await request.json()

    // Inject tenant connection_ids so the orchestrator only includes this tenant's data
    const tenantConnectionIds = await getTenantConnectionIds()
    body.connection_ids = Array.from(tenantConnectionIds)

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
