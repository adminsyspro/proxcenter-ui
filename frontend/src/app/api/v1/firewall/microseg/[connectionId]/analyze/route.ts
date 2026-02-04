// src/app/api/v1/firewall/microseg/[connectionId]/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const searchParams = request.nextUrl.searchParams
    const gatewayOffset = searchParams.get('gateway_offset') || '254'
    
    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/microseg/${connectionId}/analyze?gateway_offset=${gatewayOffset}`)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error analyzing microsegmentation:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to analyze' },
      { status: 500 }
    )
  }
}
