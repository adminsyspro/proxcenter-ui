// src/app/api/v1/orchestrator/reports/schedules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/schedules - List schedules
export async function GET() {
  try {
    const data = await orchestratorFetch('/reports/schedules')

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get schedules:', error)
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
    console.error('Failed to create schedule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create schedule' },
      { status: 500 }
    )
  }
}
