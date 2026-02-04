// src/app/api/v1/orchestrator/drs/maintenance/[node]/evacuate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ node: string }>
}

// POST /api/v1/orchestrator/drs/maintenance/:node/evacuate - Évacuer un nœud
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
    const response = await client.post(`/drs/maintenance/${node}/evacuate`, body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Failed to evacuate node:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to evacuate node' },
      { status: 500 }
    )
  }
}
