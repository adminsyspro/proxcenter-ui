// src/app/api/v1/orchestrator/drs/maintenance/[node]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ node: string }>
}

// POST /api/v1/orchestrator/drs/maintenance/:node - Entrer en maintenance
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { node } = await params
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const response = await client.post(`/drs/maintenance/${node}`, body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Failed to enter maintenance mode:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to enter maintenance mode' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/orchestrator/drs/maintenance/:node - Sortir de maintenance
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { node } = await params
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const response = await client.delete(`/drs/maintenance/${node}`)

    
return NextResponse.json(response.data || { success: true })
  } catch (error: any) {
    console.error('Failed to exit maintenance mode:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to exit maintenance mode' },
      { status: 500 }
    )
  }
}
