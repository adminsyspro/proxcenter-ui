// src/app/api/v1/firewall/aliases/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// GET /api/v1/firewall/aliases/[connectionId] - Get all aliases
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/aliases/${connectionId}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching aliases:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch aliases' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/aliases/[connectionId] - Create alias
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/aliases/${connectionId}`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error creating alias:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create alias' },
      { status: 500 }
    )
  }
}
