import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/rules/[id]
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rule = await orchestratorFetch(`/alerts/rules/${id}`)

    
return NextResponse.json(rule)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules/[id]] GET error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Rule not found' },
      { status: 404 }
    )
  }
}

/**
 * PUT /api/v1/orchestrator/alerts/rules/[id]
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    const result = await orchestratorFetch(`/alerts/rules/${id}`, {
      method: 'PUT',
      body
    })

    
return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules/[id]] PUT error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/orchestrator/alerts/rules/[id]
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const result = await orchestratorFetch(`/alerts/rules/${id}`, {
      method: 'DELETE'
    })

    
return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules/[id]] DELETE error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
