// src/app/api/v1/firewall/nodes/[connectionId]/[node]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// GET /api/v1/firewall/nodes/[connectionId]/[node] - Get node options or rules
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'options'

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/nodes/${connectionId}/${node}/${type}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching node firewall:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch node firewall' },
      { status: 500 }
    )
  }
}

// PUT /api/v1/firewall/nodes/[connectionId]/[node] - Update node options
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.put(`/firewall/nodes/${connectionId}/${node}/options`, body)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error updating node options:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update node options' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/nodes/[connectionId]/[node] - Add node rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/nodes/${connectionId}/${node}/rules`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add node rule' },
      { status: 500 }
    )
  }
}
