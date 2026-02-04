// src/app/api/v1/orchestrator/reports/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports - List reports
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get('limit') || '50'
    const offset = searchParams.get('offset') || '0'
    const type = searchParams.get('type') || ''
    const status = searchParams.get('status') || ''

    let url = `/reports?limit=${limit}&offset=${offset}`
    if (type) url += `&type=${type}`
    if (status) url += `&status=${status}`

    const data = await orchestratorFetch(url)

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get reports:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get reports' },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/reports - Generate a new report
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const data = await orchestratorFetch('/reports', {
      method: 'POST',
      body
    })

    return NextResponse.json(data, { status: 202 })
  } catch (error: any) {
    console.error('Failed to generate report:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate report' },
      { status: 500 }
    )
  }
}
