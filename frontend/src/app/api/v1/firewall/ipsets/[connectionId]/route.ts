// src/app/api/v1/firewall/ipsets/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// GET /api/v1/firewall/ipsets/[connectionId] - Get all IP sets
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/ipsets/${connectionId}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching IP sets:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch IP sets' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/ipsets/[connectionId] - Create IP set
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/ipsets/${connectionId}`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error creating IP set:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create IP set' },
      { status: 500 }
    )
  }
}
