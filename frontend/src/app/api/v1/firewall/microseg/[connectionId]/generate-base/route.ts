// src/app/api/v1/firewall/microseg/[connectionId]/generate-base/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()
    
    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/microseg/${connectionId}/generate-base`, body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error generating base SGs:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to generate' },
      { status: 500 }
    )
  }
}
