// src/app/api/v1/firewall/cluster/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// GET /api/v1/firewall/cluster/[connectionId] - Get cluster options or rules
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'options'

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/cluster/${connectionId}/${type}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching cluster firewall:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch cluster firewall' },
      { status: 500 }
    )
  }
}

// PUT /api/v1/firewall/cluster/[connectionId] - Update cluster options
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.put(`/firewall/cluster/${connectionId}/options`, body)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error updating cluster options:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update cluster options' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/cluster/[connectionId] - Add cluster rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/cluster/${connectionId}/rules`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding cluster rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add cluster rule' },
      { status: 500 }
    )
  }
}
