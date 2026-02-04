// src/app/api/v1/orchestrator/reports/schedules/[id]/run/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// POST /api/v1/orchestrator/reports/schedules/[id]/run - Run schedule now
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const data = await orchestratorFetch(`/reports/schedules/${id}/run`, {
      method: 'POST'
    })

    return NextResponse.json(data, { status: 202 })
  } catch (error: any) {
    console.error('Failed to run schedule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to run schedule' },
      { status: 500 }
    )
  }
}
