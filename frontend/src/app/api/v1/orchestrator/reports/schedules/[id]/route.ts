// src/app/api/v1/orchestrator/reports/schedules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/schedules/[id] - Get a single schedule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const data = await orchestratorFetch(`/reports/schedules/${id}`)

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get schedule:', error)
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
    const body = await request.json()

    const data = await orchestratorFetch(`/reports/schedules/${id}`, {
      method: 'PUT',
      body
    })

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to update schedule:', error)
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
    const data = await orchestratorFetch(`/reports/schedules/${id}`, {
      method: 'DELETE'
    })

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to delete schedule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete schedule' },
      { status: 500 }
    )
  }
}
